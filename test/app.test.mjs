import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { createApp } from '../server.mjs';
import { assessModeExposure, estimateTrip, buildCommuteMatrix } from '../lib/calculator.mjs';
import {
  answerQuestionOffline,
  buildDailyPlan,
  buildDemoForecast,
  buildIndoorPlan,
  analyzeForecast,
  resolveReading
} from '../lib/engine.mjs';
import { DEFAULT_PROFILE } from '../lib/data.mjs';

test('estimateTrip computes deterministic CO2 factors and dual-impact trade-offs', () => {
  // Car (130 g/km) to Bus (15.2 g/km) over 20 km solo
  const busTrip = estimateTrip({ from: 'car', to: 'bus', km: 20, occupants: 1, aqi: 428 });
  assert.ok(Math.abs(busTrip.fromKg - 2.6) < 0.0001);
  assert.ok(Math.abs(busTrip.toKg - 0.304) < 0.0001);
  assert.ok(Math.abs(busTrip.delta - 2.296) < 0.0001);
  assert.ok(Math.abs(busTrip.monthlyDelta - 2.296 * 22) < 0.001);

  // Carpooling with 4 occupants divides car CO2 per traveller by 4
  const carpool = estimateTrip({ from: 'car', to: 'metro', km: 20, occupants: 4, aqi: 428 });
  assert.ok(Math.abs(carpool.fromKg - 0.65) < 0.0001);
  assert.equal(carpool.exposure.tradeoffWarning, '');

  // Switching from enclosed car to open walking/cycling at Severe AQI 428 triggers trade-off warning
  const smogActive = estimateTrip({ from: 'car', to: 'active', km: 10, occupants: 1, aqi: 428 });
  assert.equal(smogActive.toKg, 0);
  assert.match(smogActive.exposure.tradeoffWarning, /Dual-impact trade-off/);

  // Same switch at Satisfactory AQI 75 does not trigger smog trade-off warning
  const cleanActive = estimateTrip({ from: 'car', to: 'active', km: 10, occupants: 1, aqi: 75 });
  assert.equal(cleanActive.exposure.tradeoffWarning, '');

  // Invalid inputs throw
  assert.throws(() => estimateTrip({ from: 'car', to: 'bus', km: 0, occupants: 1 }));
  assert.throws(() => estimateTrip({ from: 'car', to: 'bus', km: 10, occupants: 9 }));
  assert.throws(() => estimateTrip({ from: 'plane', to: 'bus', km: 10, occupants: 1 }));
});

test('assessModeExposure and commute matrix prioritize low-exposure low-emission transit in severe smog', () => {
  const metroExp = assessModeExposure('metro', 428, true);
  const activeExp = assessModeExposure('active', 428, true);
  assert.ok(metroExp.score < activeExp.score);

  const matrix = buildCommuteMatrix(DEFAULT_PROFILE, 428, 12, 1);
  assert.equal(matrix.baseline, 'car');
  assert.ok(matrix.rows.some(r => r.recommended));
  const activeRow = matrix.rows.find(r => r.mode === 'active');
  assert.equal(activeRow.badge, 'Smog trade-off');
});

test('engine builds tailored daily plans, indoor plans, and safety-guarded Q&A', () => {
  const solidProfile = { ...DEFAULT_PROFILE, city: 'Patna', fuel: 'solid', purifier: false, exhaust: false };
  const reading = resolveReading(solidProfile);
  const forecast = analyzeForecast(buildDemoForecast('Patna'), reading, solidProfile);
  const plan = buildDailyPlan(solidProfile, reading, forecast);
  const indoor = buildIndoorPlan(solidProfile, reading);

  assert.equal(plan.timeline.length, 4);
  assert.equal(plan.actions.length, 5);
  assert.ok(indoor.recommendations.some(r => r.id === 'indoor_fuel_switch'));
  assert.ok(indoor.recommendations.some(r => r.id === 'indoor_diy_boxfan'));

  const kidsAns = answerQuestionOffline('Should children play outside?', solidProfile, reading, forecast);
  assert.equal(kidsAns.topic, 'kids_outdoor');
  assert.match(kidsAns.title, /indoors/i);

  const urgentAns = answerQuestionOffline('I have chest pain and cannot breathe', solidProfile, reading, forecast);
  assert.equal(urgentAns.mode, 'Safety guidance');
  assert.equal(urgentAns.topic, 'urgent_medical');

  const medAns = answerQuestionOffline('What inhaler dosage should I take?', solidProfile, reading, forecast);
  assert.equal(medAns.mode, 'Safety guidance');
  assert.equal(medAns.topic, 'clinical_boundary');
});

test('full HTTP + SQLite workflow persists across restarts and isolates sessions', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'saans-v2-'));
  const database = join(temp, 'saans.sqlite');
  let app;
  let origin;
  let cookie = '';

  const launch = async () => {
    app = createApp({ database });
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    origin = 'http://127.0.0.1:' + app.address().port;
  };
  const stop = () => new Promise((resolve, reject) => app.close(err => (err ? reject(err) : resolve())));

  const api = async (path, { body, method = 'GET', isolated = false } = {}) => {
    const res = await fetch(origin + '/api/' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(isolated || !cookie ? {} : { Cookie: cookie })
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (!isolated && res.headers.has('set-cookie')) {
      cookie = res.headers.get('set-cookie').split(';')[0];
    }
    return [res.status, await res.json()];
  };

  try {
    await launch();

    // Static pages
    const homeRes = await fetch(origin);
    assert.equal(homeRes.status, 200);
    assert.match(await homeRes.text(), /Saans — GenAI-Powered Winter Smog Assistant/);
    assert.equal((await fetch(origin + '/app.js')).status, 200);
    assert.equal((await fetch(origin + '/style.css')).status, 200);

    // Meta & initial profile
    const [metaStatus, meta] = await api('meta');
    assert.equal(metaStatus, 200);
    assert.ok(Object.hasOwn(meta.cities, 'Delhi'));
    assert.ok(Object.hasOwn(meta.cities, 'Patna'));

    const [bootStatus, boot] = await api('profile');
    assert.equal(bootStatus, 200);
    assert.equal(boot.reading.value, 428);
    assert.equal(boot.reading.manual, false);
    assert.equal(boot.forecast.rows.length, 8);

    // Update profile
    const [updStatus, updated] = await api('profile', {
      method: 'PUT',
      body: {
        ...boot.profile,
        city: 'Nagpur',
        fuel: 'solid',
        purifier: true,
        vulnerableGroups: ['children', 'seniors'],
        aqi: 380,
        time: new Date().toISOString()
      }
    });
    assert.equal(updStatus, 200);
    assert.equal(updated.reading.stale, false);
    assert.equal(updated.reading.value, 380);
    assert.ok(updated.indoor.recommendations.some(r => r.id === 'indoor_hepa_room'));

    // Invalid profile rejection
    assert.equal((await api('profile', { method: 'PUT', body: { ...boot.profile, aqi: -1 } }))[0], 400);
    assert.equal((await api('profile', { method: 'PUT', body: { ...boot.profile, aqi: 501 } }))[0], 400);

    // Forecast
    const [fcStatus, fc] = await api('forecast');
    assert.equal(fcStatus, 200);
    assert.equal(fc.rows.length, 8);
    assert.ok(fc.bestSlot && fc.peakSlot);

    // Ask Saans
    const [askStatus, askRes] = await api('ask', {
      method: 'POST',
      body: { question: 'How can I improve indoor air on a budget?' }
    });
    assert.equal(askStatus, 200);
    assert.equal(askRes.topic, 'indoor_budget');

    const [, urgentRes] = await api('ask', {
      method: 'POST',
      body: { question: 'I have chest pain after walking outside' }
    });
    assert.equal(urgentRes.mode, 'Safety guidance');

    // Impact & trips CRUD
    const tripPayload = { from: 'car', to: 'metro', km: 20, occupants: 1 };
    const [impStatus, impact] = await api('impact', { method: 'POST', body: tripPayload });
    assert.equal(impStatus, 200);
    assert.ok(impact.delta > 2.3);

    assert.equal((await api('trips', { method: 'POST', body: { ...tripPayload, km: null } }))[0], 400);

    const [t1Status, t1] = await api('trips', { method: 'POST', body: tripPayload });
    assert.equal(t1Status, 201);
    assert.equal(t1.stats.count, 1);

    const [t2Status, t2] = await api('trips', {
      method: 'POST',
      body: { from: 'car', to: 'bus', km: 10, occupants: 1 }
    });
    assert.equal(t2Status, 201);
    assert.equal(t2.stats.count, 2);

    // Checklist & Pledges
    const [clStatus] = await api('checklist', {
      method: 'PUT',
      body: { date: '2026-11-26', completed: ['outdoor', 'indoor'] }
    });
    assert.equal(clStatus, 200);

    const [plStatus] = await api('pledges', {
      method: 'PUT',
      body: { pledges: ['rwa_no_idling', 'rwa_no_burning'] }
    });
    assert.equal(plStatus, 200);

    // Restart server & check persistence + session isolation
    await stop();
    await launch();

    const [, restored] = await api('profile');
    assert.equal(restored.profile.city, 'Nagpur');
    assert.deepEqual(restored.checklist.completed, ['outdoor', 'indoor']);
    assert.deepEqual(restored.pledges, ['rwa_no_idling', 'rwa_no_burning']);
    assert.equal(restored.trips.length, 2);
    assert.equal(restored.tripStats.count, 2);

    // Isolated session cannot see or delete original session's trips
    const [, isoTrips] = await api('trips', { isolated: true });
    assert.equal(isoTrips.trips.length, 0);
    assert.equal(
      (await api(`trips/${t1.trip.id}`, { method: 'DELETE', isolated: true }))[0],
      404
    );

    // Original session deletes one trip, then clears remaining
    const [delOneStatus, delOne] = await api(`trips/${t1.trip.id}`, { method: 'DELETE' });
    assert.equal(delOneStatus, 200);
    assert.equal(delOne.stats.count, 1);

    assert.equal((await api('trips', { method: 'DELETE' }))[0], 200);
    assert.equal((await api('trips'))[1].trips.length, 0);
  } finally {
    if (app?.listening) await stop();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('security headers, ETag 304 caching, payload limits, and input sanitization hold', async () => {
  const app = createApp({ database: ':memory:' });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const origin = 'http://127.0.0.1:' + app.address().port;

  try {
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(home.headers.get('permissions-policy'));
    assert.match(home.headers.get('content-security-policy') || '', /default-src 'self'/);

    const etag = home.headers.get('etag');
    assert.ok(etag);
    const cached = await fetch(origin, { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);

    const csrf = await fetch(origin + '/api/profile', {
      headers: { 'Sec-Fetch-Site': 'cross-site' }
    });
    assert.equal(csrf.status, 403);

    assert.equal((await fetch(origin + '/../server.mjs')).status, 404);

    const oversized = await fetch(origin + '/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'x'.repeat(20000) })
    });
    assert.equal(oversized.status, 413);

    const malformed = await fetch(origin + '/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid'
    });
    assert.equal(malformed.status, 400);

    const protoPoll = await fetch(origin + '/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"city":"__proto__"}'
    });
    assert.equal(protoPoll.status, 400);

    const badChecklist = await fetch(origin + '/api/checklist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: 'bad-date', completed: ['outdoor'] })
    });
    assert.equal(badChecklist.status, 400);

    const badPledge = await fetch(origin + '/api/pledges', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pledges: ['not_a_valid_pledge'] })
    });
    assert.equal(badPledge.status, 400);
  } finally {
    await new Promise((resolve, reject) => app.close(err => (err ? reject(err) : resolve())));
  }
});

test('Q&A classifier covers all topics, stale manual AQI is detected, and forecast preserves manual AQI', async () => {
  const { classifyTopic } = await import('../lib/engine.mjs');
  assert.equal(classifyTopic('Does carpooling reduce smog?'), 'commute_tradeoff');
  assert.equal(classifyTopic('Is winter smog risky during pregnancy?'), 'vulnerable');
  assert.equal(classifyTopic('Which N95 mask should I wear?'), 'masks');
  assert.equal(classifyTopic('When should we open windows for ventilation?'), 'ventilation');
  assert.equal(classifyTopic('How can our RWA stop waste burning?'), 'community');
  assert.equal(classifyTopic('Why does temperature inversion happen in winter?'), 'winter_science');

  const staleOld = resolveReading({
    ...DEFAULT_PROFILE,
    aqi: 310,
    time: new Date(Date.now() - 3 * 3600 * 1000).toISOString()
  });
  assert.equal(staleOld.stale, true);

  const staleFuture = resolveReading({
    ...DEFAULT_PROFILE,
    aqi: 310,
    time: new Date(Date.now() + 3600 * 1000).toISOString()
  });
  assert.equal(staleFuture.stale, true);

  const app = createApp({ database: ':memory:' });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const origin = 'http://127.0.0.1:' + app.address().port;

  try {
    const boot = await fetch(origin + '/api/profile');
    const cookie = boot.headers.get('set-cookie').split(';')[0];
    const bootJson = await boot.json();

    await fetch(origin + '/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        ...bootJson.profile,
        city: 'Bengaluru',
        aqi: 350,
        time: new Date().toISOString()
      })
    });

    const fcRes = await fetch(origin + '/api/forecast?city=Bengaluru', {
      headers: { Cookie: cookie }
    });
    const fc = await fcRes.json();
    assert.match(fc.windowAdvice, /Very Poor/);

    const impRes = await fetch(origin + '/api/impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ from: 'car', to: 'metro', km: 25, occupants: 2 })
    });
    const imp = await impRes.json();
    assert.equal(imp.matrix.km, 25);
    assert.equal(imp.matrix.occupants, 2);
  } finally {
    await new Promise((resolve, reject) => app.close(err => (err ? reject(err) : resolve())));
  }
});
