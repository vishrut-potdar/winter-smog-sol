import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  AQI_BANDS,
  CITIES,
  COMMUNITY_TEMPLATES,
  DEFAULT_PROFILE,
  MODES,
  SDGS,
  SMOG_SCIENCE,
  SOURCES,
  VULNERABLE_GROUPS
} from './lib/data.mjs';
import { buildCommuteMatrix, estimateTrip } from './lib/calculator.mjs';
import {
  analyzeForecast,
  answerQuestionOffline,
  buildDailyPlan,
  buildDemoForecast,
  buildIndoorPlan,
  checkSafetyGuardrails,
  resolveReading
} from './lib/engine.mjs';

const ASSETS = new Map(
  [
    ['/', ['index.html', 'text/html']],
    ['/index.html', ['index.html', 'text/html']],
    ['/app.js', ['app.js', 'text/javascript']],
    ['/style.css', ['style.css', 'text/css']]
  ].map(([route, [file, type]]) => {
    const content = readFileSync(new URL('./public/' + file, import.meta.url));
    const etag = '"' + createHash('sha256').update(content).digest('base64url').slice(0, 16) + '"';
    return [route, [content, type, etag]];
  })
);

const COOKIE_NAME = 'saans_session';
const LIVE_FORECAST_TTL_MS = 5 * 60 * 1000;
const LIVE_FORECAST_CACHE = new Map();
const VALID_COMMUNITY_IDS = new Set(
  Object.values(COMMUNITY_TEMPLATES).flatMap(group => group.actions.map(a => a.id))
);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function normalizeProfile(raw = {}) {
  const merged = { ...DEFAULT_PROFILE, ...raw };
  if (!Array.isArray(merged.vulnerableGroups)) {
    merged.vulnerableGroups = merged.sensitive ? ['children'] : [];
  }
  return merged;
}

function validateProfile(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid profile settings.');
  }
  const p = normalizeProfile(input);

  if (!Object.hasOwn(CITIES, p.city)) {
    throw new Error('Unsupported city selected.');
  }
  if (!Object.hasOwn(MODES, p.commute)) {
    throw new Error('Unsupported commute mode.');
  }
  if (!['gas', 'electric', 'solid'].includes(p.fuel)) {
    throw new Error('Invalid cooking fuel option.');
  }
  if (typeof p.sensitive !== 'boolean' || typeof p.purifier !== 'boolean') {
    throw new Error('Invalid boolean household setting.');
  }
  if (typeof p.exhaust !== 'boolean' || typeof p.masks !== 'boolean' || typeof p.ac !== 'boolean') {
    throw new Error('Invalid appliance setting.');
  }
  if (!['low', 'moderate', 'flexible'].includes(p.budget)) {
    throw new Error('Invalid budget preference.');
  }
  if (
    !Array.isArray(p.vulnerableGroups) ||
    p.vulnerableGroups.some(g => !Object.hasOwn(VULNERABLE_GROUPS, g))
  ) {
    throw new Error('Invalid vulnerable group selection.');
  }
  if (p.aqi !== null && (!Number.isInteger(p.aqi) || p.aqi < 0 || p.aqi > 500)) {
    throw new Error('Manual India AQI must be a whole number from 0 to 500.');
  }
  if (
    typeof p.time !== 'string' ||
    (p.time &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.time) ||
        !Number.isFinite(Date.parse(p.time))))
  ) {
    throw new Error('Invalid reading timestamp.');
  }

  // Keep sensitive flag aligned if vulnerableGroups were explicitly edited
  if (Array.isArray(input.vulnerableGroups) && input.vulnerableGroups.length > 0) {
    p.sensitive = true;
  } else if (Array.isArray(input.vulnerableGroups) && input.vulnerableGroups.length === 0 && input.sensitive === undefined) {
    p.sensitive = false;
  }

  return {
    city: p.city,
    aqi: p.aqi,
    time: p.time,
    commute: p.commute,
    fuel: p.fuel,
    sensitive: p.sensitive,
    vulnerableGroups: [...new Set(p.vulnerableGroups)],
    purifier: p.purifier,
    exhaust: p.exhaust,
    masks: p.masks,
    ac: p.ac,
    budget: p.budget
  };
}

async function readInput(req) {
  let size = 0;
  const buffers = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) {
      throw new HttpError(413, 'Request payload is too large.');
    }
    buffers.push(chunk);
  }
  if (!buffers.length) return {};
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}

async function fetchForecast(city, live, reading, profile) {
  let rawForecast;
  if (live) {
    const cached = LIVE_FORECAST_CACHE.get(city);
    if (cached && cached.expires > Date.now()) {
      rawForecast = cached.data;
    } else {
      try {
        const { lat, lon } = CITIES[city];
        const params = new URLSearchParams({
          latitude: String(lat),
          longitude: String(lon),
          hourly: 'pm2_5',
          timezone: 'Asia/Kolkata',
          forecast_hours: '24'
        });
        const res = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?' + params, {
          signal: AbortSignal.timeout(4500)
        });
        if (!res.ok) throw new Error('Forecast unavailable');
        const data = await res.json();
        const rows = (data.hourly?.time || [])
          .map((time, idx) => ({
            time,
            label: time.slice(11, 16),
            pm: data.hourly?.pm2_5?.[idx]
          }))
          .filter(row => Number.isFinite(row.pm) && row.pm >= 0)
          .filter((_, idx) => idx % 3 === 0)
          .slice(0, 8);
        if (rows.length < 6) throw new Error('Forecast incomplete');
        rawForecast = {
          city,
          kind: 'Open-Meteo / CAMS model forecast',
          source: SOURCES.openMeteo.url,
          fallback: false,
          rows
        };
        LIVE_FORECAST_CACHE.set(city, {
          expires: Date.now() + LIVE_FORECAST_TTL_MS,
          data: rawForecast
        });
      } catch {
        rawForecast = { ...buildDemoForecast(city), fallback: true };
      }
    }
  } else {
    rawForecast = buildDemoForecast(city);
  }

  return analyzeForecast(rawForecast, reading, profile);
}

async function answerQuestion({ question, allowAI }, profile, reading, forecastData, options) {
  if (typeof question !== 'string' || !question.trim() || question.length > 400) {
    throw new Error('Enter a question up to 400 characters.');
  }

  const guardrail = checkSafetyGuardrails(question);
  if (guardrail) return guardrail;

  const baseAnswer = answerQuestionOffline(question, profile, reading, forecastData);

  if (options.apiKey && allowAI === true) {
    try {
      const contextPayload = {
        city: profile.city,
        aqi: reading.value,
        band: reading.band.label,
        staleReading: reading.stale,
        bestWindow: forecastData.bestSlot?.label || '14:00',
        peakWindow: forecastData.peakSlot?.label || '08:00',
        household: {
          sensitive: profile.sensitive,
          vulnerableGroups: profile.vulnerableGroups,
          commute: MODES[profile.commute]?.label,
          fuel: profile.fuel,
          purifier: profile.purifier,
          exhaust: profile.exhaust
        },
        reviewedGuidance: {
          title: baseAnswer.title,
          summary: baseAnswer.summary,
          exposureNote: baseAnswer.exposureNote,
          emissionsNote: baseAnswer.emissionsNote,
          steps: baseAnswer.steps
        }
      };

      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + options.apiKey,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(7000),
        body: JSON.stringify({
          model: options.model,
          store: false,
          max_output_tokens: 260,
          instructions:
            'You are Saans, a scientific winter smog assistant. Using ONLY the provided household air context and reviewedGuidance, return valid JSON with keys: summary (string, max 2 sentences), exposureNote (string, 1 sentence), emissionsNote (string, 1 sentence), steps (array of 2-3 concise action strings). Never invent medical dosages or diagnosis. Never output markdown fences.',
          input: JSON.stringify({ question: question.trim(), context: contextPayload })
        })
      });

      if (res.ok) {
        const data = await res.json();
        const rawText = data.output
          ?.flatMap(item => item.content || [])
          .find(item => item.type === 'output_text')
          ?.text?.trim();
        if (rawText) {
          const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          const parsed = JSON.parse(cleaned);
          if (
            typeof parsed.summary === 'string' &&
            parsed.summary.trim() &&
            Array.isArray(parsed.steps) &&
            parsed.steps.length > 0
          ) {
            return {
              ...baseAnswer,
              mode: 'AI synthesized guidance',
              summary: parsed.summary.trim(),
              exposureNote:
                typeof parsed.exposureNote === 'string' && parsed.exposureNote.trim()
                  ? parsed.exposureNote.trim()
                  : baseAnswer.exposureNote,
              emissionsNote:
                typeof parsed.emissionsNote === 'string' && parsed.emissionsNote.trim()
                  ? parsed.emissionsNote.trim()
                  : baseAnswer.emissionsNote,
              steps: parsed.steps.slice(0, 3).map(s => String(s).trim()).filter(Boolean)
            };
          }
        }
      }
    } catch {
      // Fall back silently to curated offline guidance
    }
  }

  return baseAnswer;
}

function summarizeTripStats(row) {
  const count = Number(row?.count) || 0;
  const totalAvoidedKg = Number(row?.totalAvoidedKg) || 0;
  const totalKm = Number(row?.totalKm) || 0;
  const avgDelta = count > 0 ? totalAvoidedKg / count : 0;
  const monthlyProjectedKg = avgDelta * 22;
  const treesEquivalent = Math.max(0, Math.round(totalAvoidedKg / 0.06));
  return {
    count,
    totalAvoidedKg,
    totalKm,
    monthlyProjectedKg,
    treesEquivalent
  };
}

export function createApp({
  database = ':memory:',
  live = false,
  apiKey = '',
  model = 'gpt-4.1-mini'
} = {}) {
  if (database !== ':memory:') {
    mkdirSync(dirname(database), { recursive: true });
  }
  const db = new DatabaseSync(database);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      settings TEXT NOT NULL,
      checklist TEXT NOT NULL DEFAULT '{}',
      pledges TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created TEXT NOT NULL,
      details TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trips_session ON trips (session, id DESC);
  `);

  const statements = {
    getProfile: db.prepare('SELECT settings, checklist, pledges FROM profiles WHERE id = ?'),
    insertProfile: db.prepare(
      'INSERT INTO profiles (id, settings, checklist, pledges) VALUES (?, ?, ?, ?)'
    ),
    updateSettings: db.prepare('UPDATE profiles SET settings = ? WHERE id = ?'),
    updateChecklist: db.prepare('UPDATE profiles SET checklist = ? WHERE id = ?'),
    updatePledges: db.prepare('UPDATE profiles SET pledges = ? WHERE id = ?'),
    addTrip: db.prepare('INSERT INTO trips (session, created, details) VALUES (?, ?, ?)'),
    listTrips: db.prepare(
      'SELECT id, created, details FROM trips WHERE session = ? ORDER BY id DESC LIMIT 25'
    ),
    tripStatsAgg: db.prepare(`
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(CAST(json_extract(details, '$.delta') AS REAL)), 0) AS totalAvoidedKg,
        COALESCE(SUM(CAST(json_extract(details, '$.km') AS REAL)), 0) AS totalKm
      FROM trips
      WHERE session = ?
    `),
    deleteTripById: db.prepare('DELETE FROM trips WHERE id = ? AND session = ?'),
    clearTrips: db.prepare('DELETE FROM trips WHERE session = ?')
  };

  function getSessionTrips(sessionId) {
    const recent = statements.listTrips.all(sessionId).map(row => ({
      id: row.id,
      created: row.created,
      ...JSON.parse(row.details)
    }));
    const statsRow = statements.tripStatsAgg.get(sessionId);
    return { trips: recent, stats: summarizeTripStats(statsRow) };
  }

  function hydrateSession(sessionId, row) {
    const profile = normalizeProfile(JSON.parse(row.settings));
    const checklist = JSON.parse(row.checklist || '{}');
    const pledges = JSON.parse(row.pledges || '[]');
    const reading = resolveReading(profile);
    const forecast = analyzeForecast(buildDemoForecast(profile.city), reading, profile);
    const plan = buildDailyPlan(profile, reading, forecast);
    const indoor = buildIndoorPlan(profile, reading);
    const commuteMatrix = buildCommuteMatrix(profile, reading.value);
    const { trips, stats: tripStats } = getSessionTrips(sessionId);

    return {
      profile,
      reading,
      forecast,
      plan,
      indoor,
      commuteMatrix,
      checklist,
      pledges,
      trips,
      tripStats,
      aiAvailable: Boolean(apiKey),
      liveForecastDefault: Boolean(live)
    };
  }

  const server = createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(data));
    };

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    );

    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    if (method === 'GET' && ASSETS.has(path)) {
      const [file, type, etag] = ASSETS.get(path);
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': type + '; charset=utf-8',
        'Cache-Control': 'no-cache',
        ETag: etag
      });
      res.end(file);
      return;
    }

    if (!path.startsWith('/api/')) {
      json(404, { error: 'Not found.' });
      return;
    }

    if (req.headers['sec-fetch-site'] === 'cross-site') {
      json(403, { error: 'Cross-site request blocked.' });
      return;
    }

    if (method === 'GET' && path === '/api/meta') {
      return json(200, {
        cities: CITIES,
        modes: MODES,
        aqiBands: AQI_BANDS,
        vulnerableGroups: VULNERABLE_GROUPS,
        communityTemplates: COMMUNITY_TEMPLATES,
        sources: SOURCES,
        sdgs: SDGS,
        smogScience: SMOG_SCIENCE
      });
    }

    let sessionId = req.headers.cookie?.match(
      /(?:^|;\s*)saans_session=([0-9a-f-]{36})(?:;|$)/
    )?.[1];
    let row = sessionId && statements.getProfile.get(sessionId);

    if (!row) {
      sessionId = randomUUID();
      const defaultSettings = JSON.stringify(DEFAULT_PROFILE);
      statements.insertProfile.run(sessionId, defaultSettings, '{}', '[]');
      row = { settings: defaultSettings, checklist: '{}', pledges: '[]' };
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`
      );
    }

    const currentProfile = normalizeProfile(JSON.parse(row.settings));
    const currentReading = resolveReading(currentProfile);

    try {
      if (method === 'GET' && path === '/api/profile') {
        return json(200, hydrateSession(sessionId, row));
      }

      if (method === 'PUT' && path === '/api/profile') {
        const nextProfile = validateProfile(await readInput(req));
        const serialized = JSON.stringify(nextProfile);
        statements.updateSettings.run(serialized, sessionId);
        row = { ...row, settings: serialized };
        return json(200, hydrateSession(sessionId, row));
      }

      if (method === 'GET' && path === '/api/forecast') {
        const city = url.searchParams.get('city') || currentProfile.city;
        if (!Object.hasOwn(CITIES, city)) {
          return json(400, { error: 'Unsupported city.' });
        }
        const liveParam = url.searchParams.get('live');
        const useLive = liveParam === null ? Boolean(live) : liveParam === '1';
        const cityReading =
          city === currentProfile.city
            ? currentReading
            : resolveReading({ ...currentProfile, city, aqi: null, time: '' });
        const forecastData = await fetchForecast(city, useLive, cityReading, currentProfile);
        return json(200, forecastData);
      }

      if (method === 'POST' && path === '/api/impact') {
        const { from, to, km, occupants } = await readInput(req);
        const result = estimateTrip({
          from,
          to,
          km,
          occupants,
          aqi: currentReading.value,
          sensitive: currentProfile.sensitive
        });
        const matrix = buildCommuteMatrix(currentProfile, currentReading.value, km, occupants);
        return json(200, { ...result, matrix });
      }

      if (method === 'GET' && path === '/api/trips') {
        return json(200, getSessionTrips(sessionId));
      }

      if (method === 'POST' && path === '/api/trips') {
        const { from, to, km, occupants } = await readInput(req);
        const estimated = estimateTrip({
          from,
          to,
          km,
          occupants,
          aqi: currentReading.value,
          sensitive: currentProfile.sensitive
        });
        const details = {
          ...estimated,
          city: currentProfile.city,
          aqi: currentReading.value
        };
        const created = new Date().toISOString();
        const info = statements.addTrip.run(sessionId, created, JSON.stringify(details));
        const { stats } = getSessionTrips(sessionId);
        return json(201, {
          trip: { id: Number(info.lastInsertRowid), created, ...details },
          stats
        });
      }

      if (method === 'DELETE' && path.startsWith('/api/trips/')) {
        const idRaw = path.slice('/api/trips/'.length);
        if (!/^\d+$/.test(idRaw)) {
          return json(400, { error: 'Invalid trip ID.' });
        }
        const tripId = Number(idRaw);
        const info = statements.deleteTripById.run(tripId, sessionId);
        if (info.changes === 0) {
          return json(404, { error: 'Trip not found.' });
        }
        const { stats } = getSessionTrips(sessionId);
        return json(200, { deleted: true, stats });
      }

      if (method === 'DELETE' && path === '/api/trips') {
        statements.clearTrips.run(sessionId);
        const { stats } = getSessionTrips(sessionId);
        return json(200, { cleared: true, stats });
      }

      if (method === 'PUT' && path === '/api/checklist') {
        const body = await readInput(req);
        if (
          !body ||
          typeof body.date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
          !Array.isArray(body.completed) ||
          body.completed.length > 30 ||
          body.completed.some(item => typeof item !== 'string' || item.length > 64)
        ) {
          throw new Error('Invalid checklist payload.');
        }
        const checklist = {
          date: body.date,
          completed: [...new Set(body.completed)]
        };
        statements.updateChecklist.run(JSON.stringify(checklist), sessionId);
        return json(200, { checklist });
      }

      if (method === 'PUT' && path === '/api/pledges') {
        const body = await readInput(req);
        if (
          !body ||
          !Array.isArray(body.pledges) ||
          body.pledges.length > 30 ||
          body.pledges.some(id => typeof id !== 'string' || !VALID_COMMUNITY_IDS.has(id))
        ) {
          throw new Error('Invalid community pledges payload.');
        }
        const pledges = [...new Set(body.pledges)];
        statements.updatePledges.run(JSON.stringify(pledges), sessionId);
        return json(200, { pledges });
      }

      if (method === 'POST' && path === '/api/ask') {
        const body = await readInput(req);
        const forecastData = analyzeForecast(
          buildDemoForecast(currentProfile.city),
          currentReading,
          currentProfile
        );
        const reply = await answerQuestion(body, currentProfile, currentReading, forecastData, {
          apiKey,
          model
        });
        return json(200, reply);
      }

      return json(404, { error: 'Not found.' });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      return json(status, {
        error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message
      });
    }
  });

  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp({
    database: fileURLToPath(new URL('./data/saans.sqlite', import.meta.url)),
    live: process.env.LIVE_FORECAST === '1',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini'
  });
  app.listen(port, '127.0.0.1', () => {
    console.log(`Saans v2 running at http://localhost:${port}`);
  });
}
