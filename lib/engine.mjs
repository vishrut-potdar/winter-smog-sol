/**
 * Saans recommendation, forecast analysis, indoor air advisor,
 * and evidence-grounded offline Q&A + safety guardrail engine.
 */

import { CITIES, DEFAULT_PROFILE, MODES, SOURCES, getAqiBand } from './data.mjs';

const DIURNAL_FACTORS = [1.22, 1.14, 0.96, 0.76, 0.62, 0.72, 0.98, 1.18];
const DIURNAL_LABELS = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '21:00'];

/**
 * Resolves the active AQI reading (simulated city default or manual CPCB entry)
 * and checks timestamp freshness (2-hour window).
 */
export function resolveReading(profile) {
  const cityInfo = CITIES[profile.city] || CITIES[DEFAULT_PROFILE.city];
  const manual = profile.aqi !== null && profile.aqi !== undefined;
  const ms = profile.time ? new Date(profile.time).getTime() : NaN;
  const now = Date.now();
  const stale = manual && (!Number.isFinite(ms) || now - ms > 7200000 || ms > now + 60000);
  const value = manual ? profile.aqi : cityInfo.demoAqi;

  return {
    value,
    manual,
    stale,
    ms: Number.isFinite(ms) ? ms : null,
    band: getAqiBand(value),
    cityInfo
  };
}

/**
 * Generates an 8-slot winter diurnal PM2.5 series for offline demo mode.
 */
export function buildDemoForecast(city) {
  const info = CITIES[city] || CITIES[DEFAULT_PROFILE.city];
  const base = Math.round(info.demoAqi * 0.52);
  const rows = DIURNAL_LABELS.map((label, idx) => ({
    label,
    pm: Math.max(8, Math.round(base * DIURNAL_FACTORS[idx]))
  }));
  return {
    city,
    kind: 'Simulated demo forecast',
    source: null,
    fallback: false,
    rows
  };
}

/**
 * Enriches forecast rows with best clean-air window, peak pollution window,
 * and inversion context.
 */
export function analyzeForecast(forecastData, reading, profile) {
  const rows = forecastData.rows || [];
  if (!rows.length) {
    return {
      ...forecastData,
      bestSlot: null,
      peakSlot: null,
      windowAdvice: 'Refresh forecast to check today’s cleanest time window.',
      inversionNote: reading.cityInfo.winterNote
    };
  }

  let bestSlot = rows[0];
  let peakSlot = rows[0];
  for (const row of rows) {
    if (row.pm < bestSlot.pm) bestSlot = row;
    if (row.pm > peakSlot.pm) peakSlot = row;
  }

  const severeOrVeryPoor = !reading.stale && reading.value > 300;
  const poor = !reading.stale && reading.value > 200;

  let windowAdvice;
  if (reading.stale) {
    windowAdvice = `Lowest modelled PM2.5 is around ${bestSlot.label} (${Math.round(bestSlot.pm)} µg/m³), but your manual AQI is stale — verify live CPCB readings first.`;
  } else if (severeOrVeryPoor) {
    windowAdvice = `Least polluted slot is ${bestSlot.label} (~${Math.round(bestSlot.pm)} µg/m³), yet air remains hazardous (${reading.band.label}). Use this brief window only for essential errands or controlled cross-ventilation — keep ${profile.sensitive ? 'children & vulnerable members' : 'strenuous exercise'} indoors.`;
  } else if (poor) {
    windowAdvice = `Best dispersion window is around ${bestSlot.label} (~${Math.round(bestSlot.pm)} µg/m³) vs peak at ${peakSlot.label} (~${Math.round(peakSlot.pm)} µg/m³). Schedule brief outdoor errands or quick airing then.`;
  } else {
    windowAdvice = `Cleanest window is around ${bestSlot.label} (~${Math.round(bestSlot.pm)} µg/m³) — best time for outdoor play and opening windows before ${peakSlot.label} traffic/inversion buildup.`;
  }

  return {
    ...forecastData,
    bestSlot,
    peakSlot,
    windowAdvice,
    inversionNote: reading.cityInfo.winterNote
  };
}

function hasGroup(profile, group) {
  return Array.isArray(profile.vulnerableGroups) && profile.vulnerableGroups.includes(group);
}

/**
 * Builds a personalized time-of-day routine and 5 evidence-grounded action cards.
 */
export function buildDailyPlan(profile, reading, forecastData) {
  const { value, stale, band } = reading;
  const poor = !stale && value > 200;
  const veryPoor = !stale && value > 300;
  const severe = !stale && value > 400;
  const sensitive = Boolean(profile.sensitive);
  const bestLabel = forecastData?.bestSlot?.label || '14:00';
  const peakLabel = forecastData?.peakSlot?.label || '08:00';
  const hasKids = hasGroup(profile, 'children');
  const hasSeniorsOrResp = hasGroup(profile, 'seniors') || hasGroup(profile, 'respiratory') || hasGroup(profile, 'pregnant');

  const timeline = [
    {
      slot: 'Morning (06:00–10:30)',
      risk: veryPoor ? 'Peak inversion' : poor ? 'High haze' : 'Moderate morning',
      headline: veryPoor || (poor && sensitive)
        ? 'Keep windows shut & shift outdoor routines indoors'
        : 'Delay strenuous outdoor exercise until late morning',
      detail: `Winter inversions trap emissions near ${peakLabel}. ${hasKids ? 'Move school-age outdoor play indoors and pack an N95/KN95 if travelling through traffic.' : 'Use indoor stretching instead of morning roadside walks.'}`
    },
    {
      slot: `Midday window (${bestLabel})`,
      risk: severe ? 'Brief airing only' : 'Best dispersion',
      headline: severe
        ? 'Essential errands only; avoid prolonged outdoor play'
        : poor
          ? 'Brief, low-exertion outdoor window & controlled airing'
          : 'Best window for outdoor activity & home ventilation',
      detail: `PM2.5 typically dips around ${bestLabel}. ${profile.purifier ? 'Pause purifier briefly only if air feels noticeably clearer, then re-seal before dusk.' : 'Open cross-ventilation windows for 15–20 minutes only if local AQI improves.'}`
    },
    {
      slot: 'Evening (17:00–21:00)',
      risk: poor ? 'Rush-hour + cooling trap' : 'Rising evening haze',
      headline: 'Minimize indoor smoke & skip evening roadside walks',
      detail: `${profile.fuel === 'solid' ? 'Avoid indoor biomass smoke; cook in a vented space or use clean electric/gas.' : 'Run kitchen exhaust while cooking and avoid incense, candles, or mosquito coils.'} ${hasSeniorsOrResp ? 'Keep seniors and anyone with asthma in the cleanest room.' : ''}`.trim()
    },
    {
      slot: 'Night (21:00+)',
      risk: 'Overnight accumulation',
      headline: 'Protect sleep air quality',
      detail: profile.purifier
        ? 'Run your portable HEPA purifier on a quiet steady setting inside one closed bedroom sized to its CADR.'
        : 'Close outer gaps with rolled towels or weatherstripping and wet-mop bedroom floors earlier in the evening so settled dust does not resuspend.'
    }
  ];

  const actions = [
    {
      id: 'outdoor',
      category: 'EXPOSURE · OUTDOOR',
      title: severe || poor ? 'Move outdoor exertion indoors' : 'Time outdoor activity for midday dispersion',
      step: stale
        ? 'Your manual CPCB reading is over 2 hours old. Check a fresh local station before planning outdoor play or exercise.'
        : poor
          ? `${hasKids ? 'Shift children’s sports and park play indoors.' : 'Move runs and workouts indoors.'} ${hasSeniorsOrResp ? 'Seniors, pregnant members, and anyone with respiratory or heart conditions should avoid non-essential outdoor exposure.' : 'Keep necessary outdoor errands brief around ' + bestLabel + '.'}`
          : `Plan outdoor play or exercise closer to ${bestLabel} when mixing improves. ${sensitive ? 'Sensitive household members should pace strenuous exertion if AQI rises above 100.' : 'Prefer parks away from main roads.'}`,
      whyItWorks: 'Exertion doubles or triples breathing volume, multiplying inhaled PM2.5 particles.',
      exposureImpact: poor ? 'Cuts inhaled particulate dose significantly' : 'Matches activity to cleaner hours',
      emissionsImpact: 'Neutral on emissions',
      source: SOURCES.mohfw
    },
    {
      id: 'indoor',
      category: 'INDOOR AIR',
      title: profile.purifier ? 'Create a dedicated clean-air room' : 'Cut indoor particulate sources to zero',
      step: (profile.purifier
        ? 'Run your portable HEPA purifier continuously in one closed room sized to its Clean Air Delivery Rate (CADR). '
        : 'Skip incense, candles, and mosquito coils (use bed nets or screens instead), and wet-mop floors instead of dry sweeping. ') +
        (profile.fuel === 'solid'
          ? 'Solid-fuel smoke spikes indoor PM2.5 severely; shift cooking to LPG/induction where possible or vent smoke completely outdoors.'
          : profile.fuel === 'gas'
            ? 'Use an outdoor-vented kitchen chimney/exhaust fan on back burners and keep lids on pots.'
            : 'Electric/induction cooking keeps indoor combustion smoke minimal; run exhaust if frying creates fumes.'),
      whyItWorks: 'Indoor cooking smoke and burning coils often exceed outdoor smog concentrations inside closed rooms.',
      exposureImpact: 'Lowers 24-hour indoor PM2.5 exposure',
      emissionsImpact: profile.fuel === 'solid' ? 'Clean cooking cuts household smoke & soot' : 'Lowers indoor combustion',
      source: SOURCES.epa
    },
    {
      id: 'commute',
      category: 'DUAL IMPACT · COMMUTE',
      title: profile.commute === 'remote'
        ? 'Batch essential errands cleanly'
        : profile.commute === 'active' || profile.commute === 'scooter' || profile.commute === 'auto'
          ? (poor ? 'Protect against kerbside smog exposure' : 'Keep low-emission habits safely')
          : 'Swap a solo car trip for Metro or shared ride',
      step: profile.commute === 'remote'
        ? 'Combine errands into one trip around midday rather than multiple rush-hour trips.'
        : (profile.commute === 'car' || profile.commute === 'diesel_car')
          ? `Use Metro or carpool when feasible to cut per-person CO2. ${poor ? 'If driving, keep cabin AC on recirculation mode rather than pulling roadside exhaust inside.' : ''}`
          : (profile.commute === 'active' || profile.commute === 'scooter' || profile.commute === 'auto')
            ? (poor
              ? `Open-air travel in ${band.label} smog raises inhaled dose. Temporarily switch to Metro/enclosed transit or wear a snug N95/KN95 and pick side streets away from diesel traffic.`
              : 'Great low-CO2 commute — pick shaded, lower-traffic streets to stay healthier.')
            : `Public transit keeps per-traveller emissions low (~14–15 g CO2/km). ${poor ? 'Wear a fitted N95/KN95 while waiting at roadside bus stops.' : ''}`,
      whyItWorks: 'Saans weighs both tailpipe CO2 saved and how much polluted air you inhale during the trip.',
      exposureImpact: poor ? 'Avoids high-exertion roadside inhalation' : 'Keeps commute exposure controlled',
      emissionsImpact: 'Metro/bus/carpool cuts per-traveller CO2 by 50–89%',
      source: SOURCES.transport
    },
    {
      id: 'ventilation',
      category: 'VENTILATION TIMING',
      title: poor ? 'Seal inversions out; air briefly at midday' : 'Cross-ventilate during the cleanest window',
      step: poor
        ? `Keep outer windows closed during ${peakLabel} morning/evening smog peaks. Open windows briefly around ${bestLabel} only if cooking/humidity requires fresh air and outdoor haze has lifted.`
        : `Open opposite windows for 20–30 minutes around ${bestLabel} to flush indoor CO2 and cooking fumes before evening traffic picks up.`,
      whyItWorks: 'Timed ventilation dilutes indoor pollutants without letting peak morning inversion smog flood indoors.',
      exposureImpact: 'Prevents indoor PM2.5 spikes',
      emissionsImpact: 'Reduces unnecessary mechanical cooling/heating load',
      source: SOURCES.epa
    },
    {
      id: 'community',
      category: 'COMMUNITY ACTION',
      title: `Coordinate clean-air habits in ${profile.city}`,
      step: 'Share a no-idling reminder for school/society pickup gates, ensure guards have warm layers/electric heaters instead of wood fires, and report open waste burning via CPCB/municipal apps.',
      whyItWorks: 'Local burning and idling engines create intense pollution hotspots right around homes and schools.',
      exposureImpact: 'Reduces neighbourhood hotspot spikes',
      emissionsImpact: 'Eliminates local open-burning & idling emissions',
      source: SOURCES.cpcb
    }
  ];

  return {
    city: profile.city,
    aqi: value,
    band,
    timeline,
    actions
  };
}

/**
 * Generates affordable, profile-tailored indoor air guidance tagged by cost tier.
 */
export function buildIndoorPlan(profile, reading) {
  const recommendations = [];
  let score = 35;

  if (profile.fuel === 'electric') score += 20;
  else if (profile.fuel === 'gas') score += 10;

  if (profile.exhaust) score += 15;
  if (profile.purifier) score += 20;
  if (profile.masks) score += 5;
  if (profile.ac) score += 5;
  score = Math.min(100, score);

  const readinessLabel = score >= 80 ? 'Strong protection' : score >= 55 ? 'Moderate readiness' : 'High indoor risk';

  // Fuel-specific advice
  if (profile.fuel === 'solid') {
    recommendations.push({
      id: 'indoor_fuel_switch',
      tier: 'equipment',
      tierLabel: 'Appliances',
      priority: 'high',
      title: 'Transition away from solid cooking fuels',
      step: 'Wood, coal, dung, or crop residue indoors releases extreme PM2.5 and carbon monoxide. Prioritize LPG, piped gas, or an induction cooktop; until then, cook in a cross-vented outdoor/semi-open space.',
      exposureImpact: 'Cuts indoor PM2.5 spikes by over 70–90% during meals',
      emissionsImpact: 'Eliminates black carbon & indoor biomass smoke',
      source: SOURCES.who
    });
  } else {
    recommendations.push({
      id: 'indoor_cooking_vent',
      tier: 'free',
      tierLabel: '₹0 Habits',
      priority: profile.exhaust ? 'medium' : 'high',
      title: profile.exhaust ? 'Maximize your kitchen exhaust during cooking' : 'Ventilate cooking fumes directly outdoors',
      step: profile.exhaust
        ? 'Turn on your outdoor-vented chimney/exhaust fan 2 minutes before lighting the stove, cook on back burners, and keep lids on pans.'
        : 'Since no exhaust fan is set, open the kitchen window slightly while keeping interior doors closed to bedrooms during frying or tadka.',
      exposureImpact: 'Stops cooking aerosols from spreading to bedrooms',
      emissionsImpact: 'Reduces cooking fuel waste with lidded pots',
      source: SOURCES.epa
    });
  }

  // Zero-cost source elimination
  recommendations.push({
    id: 'indoor_no_smoke',
    tier: 'free',
    tierLabel: '₹0 Habits',
    priority: 'high',
    title: 'Pause incense, candles, dhoop & mosquito coils on smog days',
    step: 'Replace mosquito coils with bed nets or window mesh, and skip indoor incense/candles whenever city AQI is above 100.',
    exposureImpact: 'Prevents indoor PM2.5 levels comparable to heavy traffic',
    emissionsImpact: 'Zero indoor combustion particles',
    source: SOURCES.epa
  });

  recommendations.push({
    id: 'indoor_wet_mop',
    tier: 'free',
    tierLabel: '₹0 Habits',
    priority: 'medium',
    title: 'Wet-mop instead of dry sweeping & seal door gaps',
    step: 'Use a damp cloth/mop daily so settled smog dust is removed rather than kicked back into breathing height. Place rolled cotton towels or foam strips under main door gaps during inversions.',
    exposureImpact: 'Reduces resuspended fine dust indoors',
    emissionsImpact: 'Zero energy required',
    source: SOURCES.epa
  });

  // Purifier vs DIY affordable filtration
  if (profile.purifier) {
    recommendations.push({
      id: 'indoor_hepa_room',
      tier: 'equipment',
      tierLabel: 'Appliances',
      priority: 'high',
      title: 'Run your HEPA purifier in one sealed “Clean-Air Room”',
      step: 'Trying to filter an entire open apartment dilutes performance. Close windows and doors in the main sleeping room, match room size to your purifier’s CADR, and vacuum the outer pre-filter weekly.',
      exposureImpact: 'Can cut bedroom PM2.5 by 50–80% overnight',
      emissionsImpact: 'Lower fan speed after room cleans saves electricity',
      source: SOURCES.epa
    });
  } else {
    recommendations.push({
      id: 'indoor_diy_boxfan',
      tier: 'diy',
      tierLabel: 'Low-Cost / DIY',
      priority: 'high',
      title: 'Affordable alternative: DIY MERV-13 / HEPA box-fan filter',
      step: 'If a branded purifier is out of budget, taping a genuine MERV-13 or replacement HEPA filter snugly onto the intake of a standard box/exhaust fan (Corsi-Rosenthal style) creates effective particle filtration at a fraction of the cost.',
      exposureImpact: 'Provides real mechanical PM2.5 removal on a budget',
      emissionsImpact: 'Uses modest ~40–60W fan power',
      source: SOURCES.epa
    });
  }

  if (profile.ac) {
    recommendations.push({
      id: 'indoor_ac_recirc',
      tier: 'free',
      tierLabel: '₹0 Habits',
      priority: 'medium',
      title: 'Use fan-only recirculation & clean AC mesh filters',
      step: 'Split ACs recirculate indoor air (they do not bring outdoor smog in, unlike some window units with open vents). Clean dust screens every 2 weeks for smoother airflow.',
      exposureImpact: 'Avoids pulling unfiltered outdoor air indoors',
      emissionsImpact: 'Clean coils/filters reduce electricity draw',
      source: SOURCES.epa
    });
  }

  recommendations.push({
    id: 'indoor_masks_stock',
    tier: 'diy',
    tierLabel: 'Low-Cost / DIY',
    priority: reading.value > 200 ? 'high' : 'medium',
    title: profile.masks ? 'Check N95/KN95 nose-bridge seal before stepping out' : 'Keep fitted N95/KN95 masks near the front door',
    step: 'Cloth masks and loose surgical masks let fine PM2.5 leak around the cheeks. Keep snug N95/KN95 masks ready for days above AQI 200 (use child-sized respirators for older kids where comfortable; avoid masks for infants/toddlers under 2).',
    exposureImpact: 'Well-fitted N95 filters ≥95% of airborne PM2.5',
    emissionsImpact: 'Reusable across multiple short commutes until straps loosen or breathing resistance rises',
    source: SOURCES.mohfw
  });

  const summary = reading.value > 300
    ? `At AQI ${reading.value} (${reading.band.label}) in ${profile.city}, keeping one bedroom sealed and smoke-free gives your household ~10+ hours of recovery air each night.`
    : `Small zero-cost indoor habits plus targeted filtration keep indoor air far cleaner than ${profile.city}’s outdoor winter haze.`;

  return {
    readinessScore: score,
    readinessLabel,
    summary,
    recommendations
  };
}

/**
 * Safety guardrails for urgent symptoms and clinical/medication requests.
 */
export function checkSafetyGuardrails(question) {
  if (/chest pain|struggl.*breath|severe.*breath|cannot breathe|can.t breathe|difficulty breathing|shortness of breath|blue lips|bluish|fainting|wheezing severely/i.test(question)) {
    return {
      mode: 'Safety guidance',
      topic: 'urgent_medical',
      title: 'Seek urgent medical care immediately',
      summary: 'Chest pain, severe wheezing, fainting, or difficulty breathing requires prompt in-person medical evaluation — please call local emergency services or visit the nearest clinic immediately.',
      exposureNote: 'While awaiting medical help, stay indoors in the cleanest, smoke-free room and avoid any exertion.',
      emissionsNote: '',
      steps: [
        'Call local emergency services or go to the nearest hospital/clinic.',
        'If someone has an existing doctor-prescribed rescue inhaler plan, follow that prescribed plan while seeking care.'
      ],
      sources: [SOURCES.mohfw],
      followUps: []
    };
  }

  if (/diagnos|prescrib|dosage|medicine|medication|inhaler dose|steroid|cure|treat.*asthma/i.test(question)) {
    return {
      mode: 'Safety guidance',
      topic: 'clinical_boundary',
      title: 'Consult a qualified clinician for medical advice',
      summary: 'Saans provides environmental and exposure-reduction guidance only and cannot diagnose conditions or recommend medications or dosages.',
      exposureNote: 'Speak with your doctor or pediatrician about an asthma or respiratory action plan during high-smog weeks.',
      emissionsNote: '',
      steps: [
        'Contact your healthcare provider for personalized medical or inhaler guidance.',
        'Keep indoor air clean and avoid outdoor exertion on Poor/Severe AQI days.'
      ],
      sources: [SOURCES.mohfw],
      followUps: ['How can I reduce indoor smoke without a purifier?', 'When should children stay indoors?']
    };
  }

  return null;
}

/**
 * Deterministic topic classification for offline and fallback Q&A.
 */
export function classifyTopic(question) {
  const q = question.toLowerCase();
  if (/mask|n95|kn95|surgical|cloth mask/.test(q)) return 'masks';
  if (/budget|cheap|afford|diy|corsi|without purifier|no purifier|low cost/.test(q)) return 'indoor_budget';
  if (/window|ventilat|open.*door|fresh air|air out/.test(q)) return 'ventilation';
  if (/senior|elder|pregnan|asthma|heart|respiratory|vulnerable/.test(q)) return 'vulnerable';
  if (/carpool|ride.?shar|cycl|bike|walk|commut|metro|bus|\bcar\b|scooter|auto|traffic|travel|emission|co2/.test(q)) return 'commute_tradeoff';
  if (/communit|rwa|society|building|neighbou?r|burning|waste|idling|guard/.test(q)) return 'community';
  if (/why|inversion|winter|fog|stubble|source|pm2\.5|what is aqi/.test(q)) return 'winter_science';
  if (/indoor|purifier|hepa|smoke|cook|incense|agarbatti|coil|mop|candle|kitchen/.test(q)) return 'indoor_smoke';
  if (/play|child|kid|school|park|sport|exercis|run|outdoor|outside|air|aqi/.test(q)) return 'kids_outdoor';
  return 'general_plan';
}

/**
 * Produces a richly structured, profile-aware answer grounded in curated science.
 */
export function answerQuestionOffline(question, profile, reading, forecastData) {
  const guardrail = checkSafetyGuardrails(question);
  if (guardrail) return guardrail;

  const topic = classifyTopic(question);
  const { value, band, stale } = reading;
  const bestLabel = forecastData?.bestSlot?.label || '14:00';
  const peakLabel = forecastData?.peakSlot?.label || '08:00';
  const poor = !stale && value > 200;
  const veryPoor = !stale && value > 300;

  const templates = {
    kids_outdoor: {
      title: poor
        ? `Keep outdoor play indoors today in ${profile.city} (AQI ${value} · ${band.label})`
        : `Aim for the ${bestLabel} window for outdoor play in ${profile.city}`,
      summary: stale
        ? `Your manual AQI timestamp is stale. Check live CPCB stations before sending children outside.`
        : poor
          ? `At AQI ${value} (${band.label}), active outdoor play raises children’s breathing rate and deepens PM2.5 inhalation. Move games indoors today.`
          : `At AQI ${value} (${band.label}), brief outdoor play is safer around ${bestLabel} when winter haze disperses, avoiding busy roads.`,
      exposureNote: 'Children breathe more air per kilogram of body weight than adults, making timing and exertion critical.',
      emissionsNote: 'Choosing nearby parks or indoor play instead of driving keeps local traffic emissions down.',
      steps: poor
        ? ['Shift sports, skipping, or playtime indoors.', 'If heading out briefly for school/errands, use the midday window around ' + bestLabel + '.']
        : ['Prefer outdoor time near ' + bestLabel + ' rather than ' + peakLabel + '.', 'Watch for coughing or eye irritation in sensitive children.'],
      sources: [SOURCES.mohfw, SOURCES.cpcb],
      followUps: ['When should we open windows today?', 'Which commute has the lowest smog exposure?']
    },
    vulnerable: {
      title: `Extra protection for vulnerable household members in ${profile.city}`,
      summary: veryPoor
        ? `At AQI ${value} (${band.label}), seniors, pregnant women, and people with asthma or heart conditions should stay indoors and avoid morning/late-evening cold smog.`
        : `Monitor symptoms closely when AQI exceeds 100 in ${profile.city}, and keep outdoor errands short around ${bestLabel}.`,
      exposureNote: 'Staying inside a smoke-free room with clean air lowers acute particulate stress on lungs and blood vessels.',
      emissionsNote: 'Batching errands or using Metro/telehealth avoids adding vehicle exhaust.',
      steps: [
        'Keep prescribed routine care plans handy and avoid cold-morning walks.',
        profile.purifier ? 'Keep your HEPA purifier running in the primary sleeping room.' : 'Eliminate incense/coils and wet-mop floors daily.'
      ],
      sources: [SOURCES.mohfw, SOURCES.who],
      followUps: ['How can I improve indoor air on a budget?', 'Should we wear N95 masks outside?']
    },
    commute_tradeoff: {
      title: poor
        ? 'Balance low CO2 with low inhalation during smog'
        : `Clean-air commute options in ${profile.city}`,
      summary: poor
        ? `In ${band.label} air (AQI ${value}), cycling or open-air scootering saves CO2 (0 g/km for cycling) but multiplies inhaled roadside PM2.5. Enclosed Metro or carpooling is safer today.`
        : `At AQI ${value}, walking/cycling on quieter streets or taking Metro/bus cuts operating CO2 significantly with manageable exposure.`,
      exposureNote: poor
        ? 'Kerbside concentrations can be higher than neighbourhood averages; enclosed Metro reduces direct exhaust exposure.'
        : 'Taking side streets away from heavy diesel traffic cuts personal exposure.',
      emissionsNote: 'Switching a 12 km solo petrol car trip (1.56 kg CO2) to Metro (0.17 kg) or bus (0.18 kg) saves ~1.4 kg CO2/day.',
      steps: [
        'Use the Commute Comparison tool below to test CO2 savings and smog trade-offs.',
        poor ? 'Prefer Metro, work-from-home, or enclosed carpool; wear a snug N95 if riding open transit.' : 'Time active trips closer to ' + bestLabel + '.'
      ],
      sources: [SOURCES.transport, SOURCES.ghg],
      followUps: ['Should we wear N95 masks outside?', 'Why is smog worse in the morning?']
    },
    indoor_budget: {
      title: 'Affordable ways to clean indoor air without a pricey purifier',
      summary: 'Source control is ₹0 and often cuts indoor PM2.5 more than an undersized purifier: stop indoor smoke, wet-mop daily, seal main door gaps, and optionally build a DIY box-fan + MERV-13/HEPA filter.',
      exposureNote: 'Eliminating incense, mosquito coils, and unvented cooking smoke immediately stops indoor particle spikes.',
      emissionsNote: 'Low-cost habits and lidded cooking also save household energy and fuel.',
      steps: [
        'Ban indoor incense, candles, and mosquito coils on smog days; use nets/screens.',
        profile.fuel === 'solid' ? 'Prioritize moving solid-fuel stoves outdoors or shifting to gas/induction.' : 'Always run kitchen exhaust or crack a kitchen window while cooking.',
        'For filtration on a budget, pair a standard box/exhaust fan with a sealed MERV-13 or replacement HEPA filter.'
      ],
      sources: [SOURCES.epa, SOURCES.who],
      followUps: ['When should we open windows today?', 'How can our building help?']
    },
    indoor_smoke: {
      title: `Indoor air checklist for ${profile.city} (${profile.fuel} cooking)`,
      summary: profile.purifier
        ? 'Keep your HEPA purifier running in one closed room sized to its CADR, and pair it with vented cooking and zero indoor burning.'
        : 'Without a purifier, preventing indoor smoke (cooking fumes, coils, incense, dry sweeping) is your highest-impact protection.',
      exposureNote: 'Indoor PM2.5 stays trapped inside sealed winter homes unless vented at the kitchen source or filtered.',
      emissionsNote: 'Cooking with lids on pots and clean fuels cuts both indoor particulates and fuel consumption.',
      steps: [
        profile.fuel === 'solid' ? 'Shift away from solid fuel indoors immediately.' : 'Use outdoor-vented kitchen exhaust and back burners.',
        'Wet-mop floors rather than dry sweeping so settled particulates stay out of the air.'
      ],
      sources: [SOURCES.epa],
      followUps: ['How can I improve indoor air on a budget?', 'When should we open windows today?']
    },
    ventilation: {
      title: poor
        ? `Keep windows closed during peaks; air briefly near ${bestLabel}`
        : `Ventilate around ${bestLabel} when outdoor air is cleanest`,
      summary: poor
        ? `At AQI ${value} (${band.label}), leaving windows open all day floods indoors with fine smog. Keep windows shut during ${peakLabel} inversions and cross-ventilate briefly near ${bestLabel} only when needed.`
        : `Open opposite windows for 20–30 minutes near ${bestLabel} to flush indoor CO2 and kitchen humidity before evening traffic builds.`,
      exposureNote: 'Timed cross-ventilation balances indoor CO2 buildup against outdoor PM2.5 entry.',
      emissionsNote: 'Natural daytime airing reduces reliance on mechanical cooling/ventilation.',
      steps: [
        'Keep windows closed during early morning and late evening inversions.',
        'Always vent kitchen smoke directly outdoors while cooking.'
      ],
      sources: [SOURCES.epa, SOURCES.cpcb],
      followUps: ['Why is smog worse in the morning?', 'How can I improve indoor air on a budget?']
    },
    masks: {
      title: 'Choosing and fitting masks for winter smog',
      summary: 'Standard cloth or loose surgical masks do not seal well against microscopic PM2.5. On Poor, Very Poor, or Severe days (AQI > 200), choose a snug N95 or KN95 respirator with a nose wire.',
      exposureNote: 'Seal around the nose bridge and cheeks matters most — air leaks around gaps bypass the filter.',
      emissionsNote: 'Reuse N95/KN95 masks over multiple short trips until straps loosen, dampness builds, or breathing resistance increases.',
      steps: [
        'Use N95/KN95 when commuting in traffic or outdoors above AQI 200.',
        'Skip masks for infants/toddlers under 2 or anyone who cannot remove one independently.'
      ],
      sources: [SOURCES.mohfw],
      followUps: ['Which commute has the lowest smog exposure?', 'Can children play outside today?']
    },
    winter_science: {
      title: `Why ${profile.city}’s winter smog spikes in mornings & nights`,
      summary: `${reading.cityInfo.winterNote} Cold surface air traps exhaust, dust, and regional smoke under a warmer air layer (temperature inversion) until midday sun helps disperse pollutants near ${bestLabel}.`,
      exposureNote: `Timing errands closer to ${bestLabel} avoids the steepest ${peakLabel} particulate concentrations.`,
      emissionsNote: 'Cutting local idling, open burning, and solo car trips directly lowers the pollution trapped under inversions.',
      steps: [
        'Check the 24-hour forecast chart above to spot today’s midday dispersion dip.',
        'Avoid strenuous outdoor workouts before 10:00 AM on inversion days.'
      ],
      sources: [SOURCES.cpcb, SOURCES.openMeteo],
      followUps: ['When should we open windows today?', 'How can our building help?']
    },
    community: {
      title: `High-impact collective actions in ${profile.city}`,
      summary: 'Residential societies, schools, and offices can dramatically cut micro-hotspots by stopping gate idling, eliminating night-guard/waste bonfires, and sharing clean-air rooms.',
      exposureNote: 'No-idling pickup zones and shared HEPA lounges immediately protect children and seniors.',
      emissionsNote: 'Eliminating waste burning and organizing metro carpools reduces community-wide PM2.5 and CO2.',
      steps: [
        'Use the Community Action Builder below to select pledges for your RWA, school, or office.',
        'Report open waste burning through official municipal or CPCB channels.'
      ],
      sources: [SOURCES.cpcb],
      followUps: ['Why is smog worse in the morning?', 'Which commute has the lowest smog exposure?']
    },
    general_plan: {
      title: `Today’s clean-air strategy for ${profile.city} (AQI ${value} · ${band.label})`,
      summary: `Prioritize three levers today: move high-exertion outdoor plans indoors if AQI > 200, keep indoor smoke near zero (vented cooking, no incense/coils), and compare both CO2 and personal exposure before commuting.`,
      exposureNote: `Cleanest forecast window is around ${bestLabel}; peak inversion haze is near ${peakLabel}.`,
      emissionsNote: 'Replacing solo motor trips with Metro, bus, or carpooling reduces daily CO2 without forcing unsafe roadside cycling in severe smog.',
      steps: [
        'Review your personalized Time-of-Day Plan and Indoor Air Advisor above.',
        'Try asking a specific question below using the quick chips.'
      ],
      sources: [SOURCES.mohfw, SOURCES.epa, SOURCES.transport],
      followUps: ['Can children play outside today?', 'How can I improve indoor air on a budget?', 'Which commute has the lowest smog exposure?']
    }
  };

  return {
    mode: 'Evidence-grounded assistant',
    topic,
    ...templates[topic]
  };
}
