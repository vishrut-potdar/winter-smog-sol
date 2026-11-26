/**
 * Deterministic CO2 impact calculations, qualitative personal exposure scoring,
 * dual-impact trade-off detection, and smart commute ranking matrix.
 */

import { MODES } from './data.mjs';

/**
 * Computes qualitative personal PM2.5 exposure score (1..5) and practical tip
 * for a given commute mode under an active AQI and sensitivity flag.
 */
export function assessModeExposure(modeKey, aqi = 250, sensitive = false) {
  const mode = MODES[modeKey];
  if (!mode) {
    throw new Error('Unsupported commute mode.');
  }
  const value = Math.max(0, Math.min(500, Number(aqi) || 0));
  let score = 1;
  let tip = '';

  switch (mode.enclosure) {
    case 'indoor':
      score = value > 400 ? 2 : 1;
      tip = 'Working or studying indoors avoids traffic plumes; pair with indoor source control.';
      break;
    case 'filtered_enclosed':
      score = value <= 100 ? 1 : value <= 300 ? 2 : 3;
      tip = 'Enclosed, air-conditioned coaches shield riders from direct roadside exhaust.';
      break;
    case 'enclosed_ac':
      score = value <= 100 ? 1 : value <= 200 ? 2 : value <= 400 ? 3 : 4;
      tip = 'Keep cabin climate on recirculation mode rather than drawing outside traffic air.';
      break;
    case 'semi_enclosed':
      score = value <= 100 ? 1 : value <= 200 ? 2 : value <= 300 ? 3 : 4;
      tip = 'Sit away from open windows in heavy traffic; wear a well-fitted N95/KN95 on Poor+ days.';
      break;
    case 'open_traffic':
      score = value <= 50 ? 1 : value <= 100 ? 2 : value <= 200 ? 3 : value <= 300 ? 4 : 5;
      tip = 'Open riders inhale concentrated kerbside exhaust; wear a sealed N95/KN95 and avoid arterial bottlenecks.';
      break;
    case 'open_exertion':
    default:
      score = value <= 50 ? 1 : value <= 100 ? 2 : value <= 200 ? 3 : value <= 300 ? 4 : 5;
      tip = 'Higher breathing rate (~2x+) multiplies inhaled PM2.5 when AQI is Poor or worse; choose low-PM midday hours or indoor transit.';
      break;
  }

  if (sensitive && value > 100 && (mode.enclosure === 'open_traffic' || mode.enclosure === 'open_exertion')) {
    score = Math.min(5, score + 1);
  }

  const levels = {
    1: 'Low',
    2: 'Moderate',
    3: 'Elevated',
    4: 'High',
    5: 'Very High'
  };

  return {
    score,
    level: levels[score],
    tip
  };
}

function kgPerTraveller(modeKey, km, occupants) {
  const mode = MODES[modeKey];
  const divisor = mode.perOccupant ? Math.min(occupants, mode.maxOccupants) : 1;
  return (mode.gPerKm * km) / divisor / 1000;
}

/**
 * Deterministic operating CO2 comparison + qualitative exposure trade-off check.
 */
export function estimateTrip({ from, to, km, occupants, aqi = 250, sensitive = false }) {
  if (!Object.hasOwn(MODES, from) || !Object.hasOwn(MODES, to)) {
    throw new Error('Invalid commute mode selected.');
  }
  if (!Number.isFinite(km) || km < 1 || km > 300) {
    throw new Error('Round-trip distance must be between 1 and 300 km.');
  }
  if (!Number.isInteger(occupants) || occupants < 1 || occupants > 7) {
    throw new Error('Occupants must be an integer between 1 and 7.');
  }

  const fromKg = kgPerTraveller(from, km, occupants);
  const toKg = kgPerTraveller(to, km, occupants);
  const delta = fromKg - toKg;

  // 22 commute days/month, 240 commute days/year
  const monthlyDelta = delta * 22;
  const annualDelta = delta * 240;
  // ~2.31 kg CO2 per litre of petrol burned; ~0.06 kg CO2/day absorbed by a mature tree
  const petrolLitresMonthly = Math.max(0, monthlyDelta / 2.31);
  const treeDaysMonthly = Math.max(0, Math.round(monthlyDelta / 0.06));

  const fromExp = assessModeExposure(from, aqi, sensitive);
  const toExp = assessModeExposure(to, aqi, sensitive);

  let tradeoffWarning = '';
  if (delta > 0 && toExp.score > fromExp.score && aqi > 200) {
    tradeoffWarning = `Dual-impact trade-off: Switching from ${MODES[from].label} to ${MODES[to].label} saves ${delta.toFixed(2)} kg CO2/day, but raises personal smog exposure (${fromExp.level} → ${toExp.level}) at AQI ${aqi}. Prefer Metro, enclosed shared rides, or well-fitted N95 protection during smog peaks.`;
  }

  let summary = '';
  if (toExp.score < fromExp.score && delta > 0) {
    summary = 'Win-win switch: lowers both personal smog exposure and transport CO2 emissions.';
  } else if (delta > 0 && toExp.score <= fromExp.score) {
    summary = 'Cuts operating CO2 emissions without increasing your personal smog exposure.';
  } else if (tradeoffWarning) {
    summary = 'Cuts CO2 emissions but increases inhaled smog exposure in today’s poor air.';
  } else if (delta < 0) {
    summary = 'Increases per-traveller CO2 emissions compared to your current mode.';
  } else {
    summary = 'Similar emissions and exposure profile under current settings.';
  }

  return {
    from,
    to,
    km,
    occupants,
    fromKg,
    toKg,
    delta,
    monthlyDelta,
    annualDelta,
    petrolLitresMonthly,
    treeDaysMonthly,
    exposure: {
      from: fromExp,
      to: toExp,
      tradeoffWarning,
      summary
    }
  };
}

/**
 * Ranks alternative commute modes for the household's current AQI & distance,
 * highlighting the best balanced dual-impact switch.
 */
export function buildCommuteMatrix(profile, aqi, km = 12, occupants = 1) {
  const baseline = profile.commute === 'remote' ? 'car' : profile.commute;
  const candidates = Object.keys(MODES).filter(modeKey => modeKey !== baseline);

  const rows = candidates.map(modeKey => {
    const trip = estimateTrip({
      from: baseline,
      to: modeKey,
      km,
      occupants,
      aqi,
      sensitive: Boolean(profile.sensitive)
    });

    // Balanced score: reward CO2 saved, penalize high personal exposure at current AQI
    const aqiPenaltyWeight = aqi > 300 ? 1.8 : aqi > 200 ? 1.3 : 0.6;
    const balanceScore = trip.delta * 2 - trip.exposure.to.score * aqiPenaltyWeight;

    let badge = 'Balanced option';
    if (trip.exposure.tradeoffWarning) {
      badge = 'Smog trade-off';
    } else if (trip.delta > 0 && trip.exposure.to.score <= 2) {
      badge = 'Win-win';
    } else if (trip.delta < 0) {
      badge = 'Higher CO2';
    }

    return {
      mode: modeKey,
      label: MODES[modeKey].label,
      toKg: trip.toKg,
      delta: trip.delta,
      exposureScore: trip.exposure.to.score,
      exposureLevel: trip.exposure.to.level,
      tradeoffWarning: trip.exposure.tradeoffWarning,
      badge,
      balanceScore,
      note: MODES[modeKey].note
    };
  });

  rows.sort((a, b) => b.balanceScore - a.balanceScore);
  if (rows.length > 0 && !rows[0].tradeoffWarning && rows[0].delta >= 0) {
    rows[0].recommended = true;
    rows[0].badge = 'Best for today’s AQI';
  }

  return {
    baseline,
    baselineLabel: MODES[baseline].label,
    km,
    occupants,
    rows
  };
}
