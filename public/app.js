'use strict';

const $ = id => document.getElementById(id);

const state = {
  meta: null,
  session: null,
  indoorTier: 'all',
  audience: 'rwa',
  liveForecast: false,
  messages: []
};

let forecastAbort;
let impactAbort;
let askAbort;

async function api(path, method = 'GET', body, signal) {
  const res = await fetch('/api/' + path, {
    method,
    signal,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function sourceLink(source) {
  const a = document.createElement('a');
  a.href = source.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = (source.short || source.name) + ' ↗';
  return a;
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getCompletedIds() {
  const cl = state.session?.checklist;
  if (!cl || cl.date !== todayKey() || !Array.isArray(cl.completed)) return [];
  return cl.completed;
}

function renderHero() {
  const { profile, reading } = state.session;
  const { cities, vulnerableGroups, modes } = state.meta;
  const cityInfo = cities[profile.city];

  $('quickCity').value = profile.city;
  $('cityLabel').textContent = `${profile.city}, India`;
  $('regionLabel').textContent = cityInfo ? cityInfo.region : '';
  $('readingMode').textContent = reading.manual
    ? reading.stale
      ? 'Stale manual entry'
      : 'Manual CPCB AQI'
    : 'Demo scenario';

  $('aqiValue').textContent = reading.value;
  $('bandLabel').textContent = reading.band.label;
  $('bandLabel').style.color = '#ffd4b8';
  $('bandSummary').textContent = reading.band.summary;

  const pct = Math.max(2, Math.min(98, (reading.value / 500) * 100));
  $('aqiMarker').style.left = pct + '%';

  $('readNote').textContent = reading.manual
    ? reading.stale
      ? 'Entered reading is over 2 hours old or missing a valid timestamp. Check live CPCB.'
      : 'User-entered CPCB reading · ' +
        new Date(reading.ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) +
        ' IST'
    : 'Simulated winter smog scenario. Enter an official CPCB AQI anytime.';

  const pills = [];
  const groups = (profile.vulnerableGroups || [])
    .map(g => vulnerableGroups[g]?.split(' ')[0])
    .filter(Boolean);
  pills.push(
    el(
      'span',
      'hero-pill',
      groups.length ? 'Protecting: ' + groups.join(', ') : 'General household'
    )
  );
  pills.push(
    el('span', 'hero-pill', 'Commute: ' + (modes[profile.commute]?.label || profile.commute))
  );
  pills.push(
    el(
      'span',
      'hero-pill',
      profile.purifier ? 'HEPA purifier active' : 'No HEPA purifier (budget steps)'
    )
  );
  $('heroBadges').replaceChildren(...pills);
}

function renderForecast(data) {
  const rows = data.rows || [];
  const max = Math.max(1, ...rows.map(r => r.pm));
  const bestPm = data.bestSlot?.pm;
  const peakPm = data.peakSlot?.pm;

  const statusParts = [];
  if (data.fallback) statusParts.push('Live feed unavailable · ');
  statusParts.push(`${data.city || state.session.profile.city} · `);
  if (data.source) {
    statusParts.push(sourceLink({ short: data.kind, url: data.source }));
  } else {
    statusParts.push(data.kind);
  }
  statusParts.push(' · µg/m³ · IST');
  $('forecastStatus').replaceChildren(...statusParts);
  $('windowAdvice').textContent = data.windowAdvice || '';
  $('inversionNote').textContent = data.inversionNote || '';

  const bars = rows.map(row => {
    let cls = 'bar-item';
    let roleNote = '';
    if (bestPm !== undefined && row.pm === bestPm) {
      cls += ' best';
      roleNote = ', cleanest window';
    } else if (peakPm !== undefined && row.pm === peakPm) {
      cls += ' peak';
      roleNote = ', peak inversion';
    }

    const item = el('div', cls);
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', `${row.label}: ${Math.round(row.pm)} micrograms per cubic meter${roleNote}`);
    const val = el('div', '', String(Math.round(row.pm)));
    const rod = el('div', 'bar-rod');
    rod.style.height = Math.max(8, Math.round((row.pm / max) * 96)) + 'px';
    rod.setAttribute('aria-hidden', 'true');
    const lbl = el('span', '', row.label);
    if (row.time) lbl.title = row.time.slice(0, 10) + ' IST';
    item.append(val, rod, lbl);
    return item;
  });

  $('forecastBars').replaceChildren(...bars);
}

async function refreshForecast() {
  forecastAbort?.abort();
  forecastAbort = new AbortController();
  $('forecastStatus').textContent = 'Loading forecast…';
  try {
    const city = state.session.profile.city;
    const liveFlag = state.liveForecast ? '1' : '0';
    const data = await api(
      `forecast?city=${encodeURIComponent(city)}&live=${liveFlag}`,
      'GET',
      undefined,
      forecastAbort.signal
    );
    state.session.forecast = data;
    renderForecast(data);
  } catch {
    if (!forecastAbort.signal.aborted) {
      $('forecastStatus').textContent = 'Forecast unavailable. Try refreshing.';
    }
  }
}

async function toggleActionDone(actionId) {
  const current = new Set(getCompletedIds());
  if (current.has(actionId)) current.delete(actionId);
  else current.add(actionId);
  const payload = { date: todayKey(), completed: [...current] };
  try {
    const res = await api('checklist', 'PUT', payload);
    state.session.checklist = res.checklist;
  } catch {
    $('checklistProgress').textContent = 'Could not save checklist. Reload to retry.';
  }
  renderPlanner();
}

function renderPlanner() {
  const { plan, profile } = state.session;
  const completed = new Set(getCompletedIds());

  $('profileTag').textContent = profile.sensitive
    ? 'Sensitive household'
    : 'General household';
  $('checklistProgress').textContent = `${completed.size} / ${plan.actions.length} done today`;

  const timelineNodes = plan.timeline.map(block => {
    const card = el('article', 'time-card');
    card.append(
      el('div', 'time-slot', block.slot),
      el('span', 'time-risk', block.risk),
      el('h3', '', block.headline),
      el('p', '', block.detail)
    );
    return card;
  });
  $('timelineGrid').replaceChildren(...timelineNodes);

  const actionNodes = plan.actions.map(action => {
    const isDone = completed.has(action.id);
    const card = el('article', 'action-card' + (isDone ? ' done' : ''));

    const topRow = el('div', 'card-top-row');
    topRow.append(el('p', 'eyebrow', action.category));

    const toggleLbl = el('label', 'done-toggle');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isDone;
    cb.addEventListener('change', () => toggleActionDone(action.id));
    toggleLbl.append(cb, el('span', '', isDone ? 'Done' : 'Mark done'));
    topRow.append(toggleLbl);

    const pills = el('div', 'impact-pills');
    pills.append(
      el('div', 'impact-pill exp', 'Exposure: ' + action.exposureImpact),
      el('div', 'impact-pill emi', 'Emissions: ' + action.emissionsImpact)
    );

    card.append(
      topRow,
      el('h3', '', action.title),
      el('p', '', action.step),
      el('p', 'micro-note', action.whyItWorks),
      pills,
      sourceLink(action.source)
    );
    return card;
  });
  $('actionCards').replaceChildren(...actionNodes);
}

function renderIndoor() {
  const { indoor } = state.session;
  $('indoorSummary').textContent = indoor.summary;
  $('readinessScore').textContent = indoor.readinessScore + '%';
  $('readinessBadge').textContent = indoor.readinessLabel;

  const filtered =
    state.indoorTier === 'all'
      ? indoor.recommendations
      : indoor.recommendations.filter(item => item.tier === state.indoorTier);

  const cards = filtered.map(item => {
    const card = el('article', 'indoor-card');
    const top = el('div', 'card-top-row');
    top.append(
      el('span', 'tier-badge', item.tierLabel),
      el('span', 'micro-note', item.priority === 'high' ? 'High priority' : 'Recommended')
    );

    const pills = el('div', 'impact-pills');
    pills.append(
      el('div', 'impact-pill exp', 'Exposure: ' + item.exposureImpact),
      el('div', 'impact-pill emi', 'Emissions: ' + item.emissionsImpact)
    );

    card.append(
      top,
      el('h3', '', item.title),
      el('p', '', item.step),
      pills,
      sourceLink(item.source)
    );
    return card;
  });
  $('indoorCards').replaceChildren(...cards);
}

function renderCommuteMatrix() {
  const matrix = state.session.commuteMatrix;
  if (!matrix) return;

  const rows = matrix.rows.map(row => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'matrix-row' + (row.recommended ? ' recommended' : '');
    btn.addEventListener('click', () => {
      $('fromMode').value = matrix.baseline;
      $('toMode').value = row.mode;
      calculateImpact();
    });

    const left = el('div');
    left.append(
      el('strong', '', row.label),
      el(
        'div',
        'matrix-meta',
        `${row.delta >= 0 ? 'Saves ' + row.delta.toFixed(2) : 'Adds ' + Math.abs(row.delta).toFixed(2)} kg CO₂/day · Exposure: ${row.exposureLevel}`
      )
    );

    const badgeCls =
      'matrix-badge' +
      (row.tradeoffWarning ? ' warn' : row.recommended || row.badge === 'Win-win' ? ' good' : '');
    const right = el('span', badgeCls, row.badge);
    btn.append(left, right);
    return btn;
  });

  $('commuteMatrix').replaceChildren(...rows);
}

function currentTripPayload() {
  return {
    from: $('fromMode').value,
    to: $('toMode').value,
    km: $('tripKm').valueAsNumber,
    occupants: $('tripOccupants').valueAsNumber
  };
}

function formatDeltaText(val) {
  if (val > 0.005) return `−${val.toFixed(2)} kg avoided`;
  if (val < -0.005) return `+${Math.abs(val).toFixed(2)} kg added`;
  return '0.00 kg change';
}

async function calculateImpact() {
  impactAbort?.abort();
  impactAbort = new AbortController();
  $('logTripBtn').disabled = true;

  if (!$('impactForm').checkValidity()) {
    $('dailyDelta').textContent = '--';
    $('monthlyDelta').textContent = '--';
    $('annualDelta').textContent = '--';
    $('exposureCompare').textContent = 'Enter a valid round-trip distance (1–300 km) and occupants (1–7).';
    $('tradeoffBanner').hidden = true;
    return;
  }

  try {
    const data = await api('impact', 'POST', currentTripPayload(), impactAbort.signal);
    if (impactAbort.signal.aborted) return;

    $('dailyDelta').textContent = formatDeltaText(data.delta);
    $('monthlyDelta').textContent = formatDeltaText(data.monthlyDelta);
    $('annualDelta').textContent = formatDeltaText(data.annualDelta);

    const exp = data.exposure;
    $('exposureCompare').textContent =
      `Personal exposure: ${exp.from.level} → ${exp.to.level}. ${exp.summary}` +
      (data.monthlyDelta > 0
        ? ` (~${data.petrolLitresMonthly.toFixed(1)} L petrol / ${data.treeDaysMonthly} tree-days per month)`
        : '');

    if (exp.tradeoffWarning) {
      $('tradeoffBanner').textContent = exp.tradeoffWarning;
      $('tradeoffBanner').hidden = false;
    } else {
      $('tradeoffBanner').hidden = true;
    }

    if (data.matrix) {
      state.session.commuteMatrix = data.matrix;
      renderCommuteMatrix();
    }

    $('logTripBtn').disabled = false;
  } catch {
    if (!impactAbort.signal.aborted) {
      $('exposureCompare').textContent = 'Could not compute comparison.';
    }
  }
}

function renderTrips() {
  const { trips, tripStats } = state.session;
  const { modes } = state.meta;

  $('statAvoided').textContent = `${(tripStats?.totalAvoidedKg || 0).toFixed(2)} kg`;
  $('statKm').textContent = `${Math.round(tripStats?.totalKm || 0)} km`;
  $('statCount').textContent = String(tripStats?.count || 0);
  $('clearTripsBtn').disabled = !trips || trips.length === 0;

  if (!trips || !trips.length) {
    $('tripsList').replaceChildren(el('li', 'trip-item', 'No commute switches logged yet.'));
    return;
  }

  const items = trips.map(trip => {
    const li = el('li', 'trip-item');
    const info = el(
      'div',
      '',
      `${modes[trip.from]?.label || trip.from} → ${modes[trip.to]?.label || trip.to} · ${trip.km} km · ${formatDeltaText(trip.delta)}`
    );
    const delBtn = el('button', 'trip-delete', 'Remove');
    delBtn.type = 'button';
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true;
      try {
        await api(`trips/${trip.id}`, 'DELETE');
        await reloadTrips();
        $('tripStatus').textContent = 'Trip removed.';
      } catch {
        $('tripStatus').textContent = 'Could not remove trip.';
        delBtn.disabled = false;
      }
    });
    li.append(info, delBtn);
    return li;
  });

  $('tripsList').replaceChildren(...items);
}

async function reloadTrips() {
  const data = await api('trips');
  state.session.trips = data.trips;
  state.session.tripStats = data.stats;
  renderTrips();
}

function renderChat() {
  if (!state.messages.length) {
    const { profile, reading } = state.session;
    state.messages.push({
      role: 'bot',
      data: {
        mode: 'Evidence-grounded assistant',
        title: `Ready to help for ${profile.city} (AQI ${reading.value} · ${reading.band.label})`,
        summary:
          'Ask a question above or click a quick chip for tailored guidance on outdoor play, indoor air on a budget, N95 masks, or commute trade-offs.',
        exposureNote: 'Every reply separates what reduces personal inhalation from what cuts emissions.',
        emissionsNote: '',
        steps: [],
        sources: [],
        followUps: []
      }
    });
  }

  const nodes = state.messages.map(msg => {
    if (msg.role === 'user') {
      return el('div', 'msg msg-user', msg.text);
    }
    const d = msg.data;
    const isSafety = d.mode === 'Safety guidance';
    const box = el('div', 'msg msg-bot' + (isSafety ? ' msg-safety' : ''));
    box.append(el('div', 'msg-mode', d.mode), el('h3', '', d.title), el('p', '', d.summary));

    if (d.exposureNote || d.emissionsNote) {
      const pills = el('div', 'impact-pills');
      if (d.exposureNote) pills.append(el('div', 'impact-pill exp', 'Exposure: ' + d.exposureNote));
      if (d.emissionsNote) pills.append(el('div', 'impact-pill emi', 'Emissions: ' + d.emissionsNote));
      box.append(pills);
    }

    if (d.steps && d.steps.length) {
      const ul = el('ul', 'msg-steps');
      for (const s of d.steps) ul.append(el('li', '', s));
      box.append(ul);
    }

    if (d.sources && d.sources.length) {
      const srcRow = el('div', 'msg-sources');
      srcRow.append(el('span', 'micro-note', 'Sources:'));
      for (const src of d.sources) srcRow.append(sourceLink(src));
      box.append(srcRow);
    }

    if (d.followUps && d.followUps.length) {
      const fRow = el('div', 'chips-row');
      fRow.style.marginTop = '10px';
      fRow.style.marginBottom = '0';
      for (const q of d.followUps) {
        const chip = el('button', 'chip-btn', q);
        chip.type = 'button';
        chip.addEventListener('click', () => submitQuestion(q));
        fRow.append(chip);
      }
      box.append(fRow);
    }

    return box;
  });

  $('chatLog').replaceChildren(...nodes);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
}

async function submitQuestion(text) {
  const question = text.trim();
  if (!question) return;

  askAbort?.abort();
  askAbort = new AbortController();
  state.messages.push({ role: 'user', text: question });
  renderChat();

  const loadingBox = el('div', 'msg msg-bot', 'Reviewing scientific guidance…');
  $('chatLog').append(loadingBox);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;

  try {
    const reply = await api(
      'ask',
      'POST',
      { question, allowAI: $('useAI').checked },
      askAbort.signal
    );
    if (askAbort.signal.aborted) return;
    state.messages.push({ role: 'bot', data: reply });
    renderChat();
  } catch {
    if (!askAbort.signal.aborted) {
      loadingBox.textContent = 'Could not fetch answer. Please try again.';
    }
  }
}

function buildCommunityShareText() {
  const template = state.meta.communityTemplates[state.audience];
  const selected = new Set(state.session.pledges || []);
  const chosen = template.actions.filter(a => selected.has(a.id));
  const list = chosen.length ? chosen : template.actions.slice(0, 3);

  const lines = [
    `Saans Clean-Air Plan · ${state.session.profile.city} (${template.label})`,
    `Active AQI: ${state.session.reading.value} (${state.session.reading.band.label})`,
    '',
    'Collective actions:',
    ...list.map((a, idx) => `${idx + 1}. ${a.title} — ${a.detail}`),
    '',
    `Verify live readings & report open burning: ${state.meta.sources.cpcb.url}`
  ];
  return lines.join('\n');
}

function renderCommunity() {
  const template = state.meta.communityTemplates[state.audience];
  const selected = new Set(state.session.pledges || []);

  const nodes = template.actions.map(action => {
    const lbl = el('label', 'pledge-item');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(action.id);
    cb.addEventListener('change', async () => {
      const next = new Set(state.session.pledges || []);
      if (cb.checked) next.add(action.id);
      else next.delete(action.id);
      try {
        const res = await api('pledges', 'PUT', { pledges: [...next] });
        state.session.pledges = res.pledges;
        $('communityPreview').textContent = buildCommunityShareText();
      } catch {
        $('shareStatus').textContent = 'Could not save pledge.';
      }
    });

    const textWrap = el('div');
    textWrap.append(
      el('strong', '', action.title),
      el('span', '', `${action.detail} (${action.impactTag})`)
    );
    lbl.append(cb, textWrap);
    return lbl;
  });

  $('communityChecklist').replaceChildren(...nodes);
  $('communityPreview').textContent = buildCommunityShareText();
}

function renderResearchAndSdgs() {
  const sciNodes = state.meta.smogScience.map(item => {
    const box = el('article', 'info-item');
    box.append(el('h3', '', item.title), el('p', '', item.detail));
    return box;
  });
  $('scienceList').replaceChildren(...sciNodes);

  const sdgNodes = state.meta.sdgs.map(item => {
    const box = el('article', 'info-item');
    box.append(el('h3', '', `${item.code} · ${item.title}`), el('p', '', item.detail));
    return box;
  });
  $('sdgList').replaceChildren(...sdgNodes);
}

function populateSelectors() {
  const { cities, modes, vulnerableGroups } = state.meta;
  const cityNames = Object.keys(cities);

  $('quickCity').replaceChildren(...cityNames.map(c => new Option(c, c)));
  $('profileCity').replaceChildren(...cityNames.map(c => new Option(c, c)));

  const modeEntries = Object.entries(modes);
  $('profileCommute').replaceChildren(...modeEntries.map(([k, m]) => new Option(m.label, k)));
  $('fromMode').replaceChildren(...modeEntries.map(([k, m]) => new Option(m.label, k)));
  $('toMode').replaceChildren(...modeEntries.map(([k, m]) => new Option(m.label, k)));

  const vulnNodes = Object.entries(vulnerableGroups).map(([key, label]) => {
    const lbl = el('label', 'checkbox-item');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'vulnerable';
    cb.value = key;
    lbl.append(cb, el('span', '', label));
    return lbl;
  });
  $('vulnerableCheckboxes').replaceChildren(...vulnNodes);
}

function syncCommuteDefaults() {
  const { commute } = state.session.profile;
  $('fromMode').value = commute === 'remote' ? 'car' : commute;
  $('toMode').value = commute === 'metro' ? 'remote' : 'metro';
}

function openProfileModal(focusManual = false) {
  const p = state.session.profile;
  $('profileCity').value = p.city;
  $('profileCommute').value = p.commute;
  $('profileFuel').value = p.fuel;
  $('profileBudget').value = p.budget || 'low';
  $('manualAqi').value = p.aqi ?? '';

  if (p.time) {
    const dt = new Date(p.time);
    $('readingTime').value = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  } else {
    $('readingTime').value = '';
  }

  for (const cb of $('vulnerableCheckboxes').querySelectorAll('input[type="checkbox"]')) {
    cb.checked = (p.vulnerableGroups || []).includes(cb.value);
  }

  $('hasPurifier').checked = Boolean(p.purifier);
  $('hasExhaust').checked = Boolean(p.exhaust);
  $('hasMasks').checked = Boolean(p.masks);
  $('hasAc').checked = Boolean(p.ac);
  $('profileError').textContent = '';

  $('profileDialog').showModal();
  if (focusManual) $('manualAqi').focus();
}

function renderAll() {
  renderHero();
  renderForecast(state.session.forecast);
  renderPlanner();
  renderIndoor();
  renderCommuteMatrix();
  renderTrips();
  renderChat();
  renderCommunity();
}

function bindEvents() {
  $('quickCity').addEventListener('change', async () => {
    const city = $('quickCity').value;
    const prevCity = state.session.profile.city;
    const nextProfile = { ...state.session.profile, city, aqi: null, time: '' };
    try {
      state.session = await api('profile', 'PUT', nextProfile);
      syncCommuteDefaults();
      renderAll();
      if (state.liveForecast) refreshForecast();
      calculateImpact();
    } catch {
      $('quickCity').value = prevCity;
      $('readNote').textContent = 'Could not switch city right now. Please try again.';
    }
  });

  $('editProfileBtn').addEventListener('click', () => openProfileModal(false));
  $('enterAqiBtn').addEventListener('click', () => openProfileModal(true));
  $('cancelProfileBtn').addEventListener('click', () => $('profileDialog').close());

  $('clearManualBtn').addEventListener('click', () => {
    $('manualAqi').value = '';
    $('readingTime').value = '';
  });

  $('profileCity').addEventListener('change', () => {
    $('manualAqi').value = '';
    $('readingTime').value = '';
  });

  $('profileForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submitBtn = event.submitter;
    submitBtn.disabled = true;
    $('profileError').textContent = '';

    const aqiNum = $('manualAqi').valueAsNumber;
    const timeVal = $('readingTime').value;
    const vulnerableGroups = [...$('vulnerableCheckboxes').querySelectorAll('input:checked')].map(
      cb => cb.value
    );

    const payload = {
      city: $('profileCity').value,
      aqi: Number.isFinite(aqiNum) ? aqiNum : null,
      time: timeVal ? new Date(timeVal).toISOString() : '',
      commute: $('profileCommute').value,
      fuel: $('profileFuel').value,
      budget: $('profileBudget').value,
      vulnerableGroups,
      sensitive: vulnerableGroups.length > 0,
      purifier: $('hasPurifier').checked,
      exhaust: $('hasExhaust').checked,
      masks: $('hasMasks').checked,
      ac: $('hasAc').checked
    };

    try {
      state.session = await api('profile', 'PUT', payload);
      $('profileDialog').close();
      syncCommuteDefaults();
      renderAll();
      if (state.liveForecast) refreshForecast();
      calculateImpact();
    } catch (err) {
      $('profileError').textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  $('liveFeedToggle').addEventListener('change', () => {
    state.liveForecast = $('liveFeedToggle').checked;
    refreshForecast();
  });

  $('refreshForecastBtn').addEventListener('click', refreshForecast);

  for (const btn of document.querySelectorAll('[data-tier]')) {
    btn.addEventListener('click', () => {
      state.indoorTier = btn.dataset.tier;
      for (const b of document.querySelectorAll('[data-tier]')) {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      }
      renderIndoor();
    });
  }

  $('impactForm').addEventListener('input', calculateImpact);
  $('impactForm').addEventListener('submit', e => e.preventDefault());

  $('logTripBtn').addEventListener('click', async () => {
    $('logTripBtn').disabled = true;
    try {
      await api('trips', 'POST', currentTripPayload());
      await reloadTrips();
      $('tripStatus').textContent = 'Switch logged to your history.';
    } catch {
      $('tripStatus').textContent = 'Could not log commute switch.';
    } finally {
      calculateImpact();
    }
  });

  $('clearTripsBtn').addEventListener('click', async () => {
    if (!confirm('Clear all logged commute switches for this session?')) return;
    try {
      await api('trips', 'DELETE');
      await reloadTrips();
      $('tripStatus').textContent = 'History cleared.';
    } catch {
      $('tripStatus').textContent = 'Could not clear history.';
    }
  });

  $('askForm').addEventListener('submit', event => {
    event.preventDefault();
    const val = $('questionInput').value;
    $('questionInput').value = '';
    submitQuestion(val);
  });

  for (const chip of document.querySelectorAll('[data-question]')) {
    chip.addEventListener('click', () => submitQuestion(chip.dataset.question));
  }

  $('clearChatBtn').addEventListener('click', () => {
    state.messages = [];
    renderChat();
  });

  for (const btn of document.querySelectorAll('[data-audience]')) {
    btn.addEventListener('click', () => {
      state.audience = btn.dataset.audience;
      for (const b of document.querySelectorAll('[data-audience]')) {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      }
      renderCommunity();
    });
  }

  $('copyPlanBtn').addEventListener('click', async () => {
    const text = buildCommunityShareText();
    try {
      await navigator.clipboard.writeText(text);
      $('shareStatus').textContent = 'Copied to clipboard.';
    } catch {
      $('shareStatus').textContent = 'Copy unavailable — select from preview box.';
    }
  });

  $('downloadPlanBtn').addEventListener('click', () => {
    const text = buildCommunityShareText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saans-community-plan-${state.session.profile.city.toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    $('shareStatus').textContent = 'Downloaded .txt plan.';
  });
}

async function init() {
  try {
    const [meta, session] = await Promise.all([api('meta'), api('profile')]);
    state.meta = meta;
    state.session = session;
    state.liveForecast = Boolean(session.liveForecastDefault);
    $('liveFeedToggle').checked = state.liveForecast;
    $('aiChoice').hidden = !session.aiAvailable;
    $('editProfileBtn').disabled = false;

    populateSelectors();
    syncCommuteDefaults();
    renderResearchAndSdgs();
    renderAll();
    bindEvents();
    calculateImpact();

    if (state.liveForecast) {
      refreshForecast();
    }
  } catch {
    $('readNote').textContent = 'Could not connect to the Saans server. Reload to retry.';
  }
}

init();
