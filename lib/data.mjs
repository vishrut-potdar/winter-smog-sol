/**
 * Single source of truth for Saans reference data, cities, CPCB AQI bands,
 * transport emission factors, scientific sources, and community templates.
 */

export const SOURCES = {
  cpcb: {
    name: 'CPCB National Air Quality Index',
    short: 'CPCB AQI',
    url: 'https://app.cpcbccr.com/AQI_India/'
  },
  mohfw: {
    name: 'MoHFW / NCDC India Air Pollution Health Advisory',
    short: 'MoHFW Health Advisory',
    url: 'https://ncdc.mohfw.gov.in/uploads/pdf/Enclosure%201.%20DO%20letter%20from%20Secretary%2C%20DoHFW%20to%20CS_AP%20Advisory_2025.pdf'
  },
  epa: {
    name: 'US EPA Indoor Air Cleaners & Filters Guidance',
    short: 'EPA Indoor Air',
    url: 'https://www.epa.gov/indoor-air-quality-iaq/air-cleaners-and-air-filters-home'
  },
  who: {
    name: 'WHO Global Air Quality Guidelines',
    short: 'WHO Guidelines',
    url: 'https://www.who.int/publications/i/item/9789240034228'
  },
  transport: {
    name: 'Delhi Commute Exposure Study (US EPA HERO)',
    short: 'Commute Exposure Study',
    url: 'https://hero.epa.gov/reference/3076247/'
  },
  ghg: {
    name: 'India GHG Program Road Transport Emission Factors',
    short: 'India GHG Factors',
    url: 'https://indiaghgp.org/sites/default/files/Road%20Transport%20Technical%20Paper.pdf'
  },
  openMeteo: {
    name: 'Open-Meteo / CAMS Air Quality Forecast API',
    short: 'Open-Meteo / CAMS',
    url: 'https://open-meteo.com/en/docs/air-quality-api'
  }
};

export const CITIES = {
  Delhi: {
    lat: 28.61,
    lon: 77.21,
    demoAqi: 428,
    region: 'NCR',
    winterNote: 'Strong morning temperature inversions trap vehicular & regional smoke near ground level.'
  },
  Noida: {
    lat: 28.54,
    lon: 77.39,
    demoAqi: 393,
    region: 'NCR',
    winterNote: 'Shallow winter boundary layer slows dispersion across expressways and construction zones.'
  },
  Gurugram: {
    lat: 28.46,
    lon: 77.03,
    demoAqi: 368,
    region: 'NCR',
    winterNote: 'Calm overnight winds allow commuter exhaust and dust to build before noon mixing.'
  },
  Patna: {
    lat: 25.59,
    lon: 85.14,
    demoAqi: 342,
    region: 'Indo-Gangetic Plain',
    winterNote: 'Winter fog and biomass heating combine with low wind speeds to elevate PM2.5.'
  },
  Lucknow: {
    lat: 26.85,
    lon: 80.95,
    demoAqi: 318,
    region: 'Indo-Gangetic Plain',
    winterNote: 'Cool-season inversions keep overnight particulate concentrations elevated through mid-morning.'
  },
  Kolkata: {
    lat: 22.57,
    lon: 88.36,
    demoAqi: 267,
    region: 'Eastern Basin',
    winterNote: 'Humid winter inversions accumulate urban traffic and solid-fuel emissions near dawn and dusk.'
  },
  Nagpur: {
    lat: 21.15,
    lon: 79.09,
    demoAqi: 178,
    region: 'Central India',
    winterNote: 'Moderate cool-season haze peaks around morning and evening rush hours.'
  },
  Mumbai: {
    lat: 19.08,
    lon: 72.88,
    demoAqi: 144,
    region: 'Coastal',
    winterNote: 'Afternoon sea breezes help disperse smog, though calm winter mornings remain hazy.'
  },
  Pune: {
    lat: 18.52,
    lon: 73.86,
    demoAqi: 136,
    region: 'Deccan Plateau',
    winterNote: 'Valley cooling traps evening traffic pollution until daytime warming improves mixing.'
  },
  Bengaluru: {
    lat: 12.97,
    lon: 77.59,
    demoAqi: 88,
    region: 'Southern Plateau',
    winterNote: 'Generally satisfactory air, though arterial corridors still spike during peak commute hours.'
  }
};

export const AQI_BANDS = [
  { max: 50, label: 'Good', key: 'good', color: '#16a34a', summary: 'Minimal impact' },
  { max: 100, label: 'Satisfactory', key: 'satisfactory', color: '#65a30d', summary: 'Minor breathing discomfort to sensitive people' },
  { max: 200, label: 'Moderate', key: 'moderate', color: '#d97706', summary: 'Breathing discomfort for people with asthma, lung or heart conditions' },
  { max: 300, label: 'Poor', key: 'poor', color: '#ea580c', summary: 'Breathing discomfort to most people on prolonged exposure' },
  { max: 400, label: 'Very Poor', key: 'very-poor', color: '#dc2626', summary: 'Respiratory illness on prolonged exposure; avoid outdoor exertion' },
  { max: 500, label: 'Severe', key: 'severe', color: '#991b1b', summary: 'Affects healthy people and seriously impacts vulnerable groups' }
];

export function getAqiBand(aqi) {
  const clamped = Math.max(0, Math.min(500, Number(aqi) || 0));
  return AQI_BANDS.find(band => clamped <= band.max) || AQI_BANDS[AQI_BANDS.length - 1];
}

export const VULNERABLE_GROUPS = {
  children: 'Children & school-goers',
  seniors: 'Senior citizens (60+)',
  pregnant: 'Pregnant women',
  respiratory: 'Asthma / respiratory / heart conditions',
  outdoor_worker: 'Outdoor workers / daily commuters'
};

export const MODES = {
  car: {
    label: 'Petrol car',
    gPerKm: 130,
    perOccupant: true,
    maxOccupants: 7,
    zeroTailpipe: false,
    enclosure: 'enclosed_ac',
    breathingMultiplier: 1.0,
    note: 'High per-person tailpipe CO2 when driven solo; recirculation AC lowers cabin particulates.'
  },
  diesel_car: {
    label: 'Diesel car',
    gPerKm: 142,
    perOccupant: true,
    maxOccupants: 7,
    zeroTailpipe: false,
    enclosure: 'enclosed_ac',
    breathingMultiplier: 1.0,
    note: 'Higher operating CO2 and NOx/soot footprint; keep cabin vents on recirculation in smog.'
  },
  auto: {
    label: 'Auto-rickshaw (CNG)',
    gPerKm: 65,
    perOccupant: true,
    maxOccupants: 3,
    zeroTailpipe: false,
    enclosure: 'open_traffic',
    breathingMultiplier: 1.1,
    note: 'Lower emissions than solo cars, but open sides expose riders directly to roadside exhaust.'
  },
  scooter: {
    label: 'Petrol two-wheeler',
    gPerKm: 33.4,
    perOccupant: false,
    maxOccupants: 2,
    zeroTailpipe: false,
    enclosure: 'open_traffic',
    breathingMultiplier: 1.2,
    note: 'Moderate fuel emissions per km, yet riders breathe concentrated kerbside traffic plumes.'
  },
  ev: {
    label: 'Electric car / e-commute',
    gPerKm: 28,
    perOccupant: true,
    maxOccupants: 5,
    zeroTailpipe: true,
    enclosure: 'enclosed_ac',
    breathingMultiplier: 1.0,
    note: 'Zero tailpipe emissions (grid-adjusted lifecycle CO2) plus enclosed cabin filtration option.'
  },
  bus: {
    label: 'City bus',
    gPerKm: 15.2,
    perOccupant: false,
    maxOccupants: 1,
    zeroTailpipe: false,
    enclosure: 'semi_enclosed',
    breathingMultiplier: 1.0,
    note: 'Strong per-passenger CO2 savings; moderate exposure depending on windows and traffic.'
  },
  metro: {
    label: 'Metro / urban rail',
    gPerKm: 13.9,
    perOccupant: false,
    maxOccupants: 1,
    zeroTailpipe: true,
    enclosure: 'filtered_enclosed',
    breathingMultiplier: 1.0,
    note: 'Best dual-impact option in severe smog: low emissions and enclosed, air-conditioned coaches.'
  },
  active: {
    label: 'Walking / cycling',
    gPerKm: 0,
    perOccupant: false,
    maxOccupants: 1,
    zeroTailpipe: true,
    enclosure: 'open_exertion',
    breathingMultiplier: 2.3,
    note: 'Zero tailpipe CO2, but elevated breathing rate increases inhaled PM2.5 during poor or severe smog.'
  },
  remote: {
    label: 'Work / study from home',
    gPerKm: 0,
    perOccupant: false,
    maxOccupants: 1,
    zeroTailpipe: true,
    enclosure: 'indoor',
    breathingMultiplier: 0.7,
    note: 'Eliminates commute emissions and traffic plume exposure entirely on high-smog days.'
  }
};

export const DEFAULT_PROFILE = {
  city: 'Delhi',
  aqi: null,
  time: '',
  commute: 'car',
  fuel: 'gas',
  sensitive: true,
  vulnerableGroups: ['children'],
  purifier: false,
  exhaust: true,
  masks: false,
  ac: false,
  budget: 'low'
};

export const COMMUNITY_TEMPLATES = {
  rwa: {
    label: 'Residential Society / RWA',
    intro: 'Shared residential actions that cut local smoke and protect children and elders.',
    actions: [
      {
        id: 'rwa_no_idling',
        title: 'Enforce a no-idling zone at gates and drop-offs',
        detail: 'Ask delivery vans, cabs, and private cars to switch off engines while waiting beyond 30 seconds.',
        impactTag: 'Cuts gate-level PM2.5 & CO2'
      },
      {
        id: 'rwa_no_burning',
        title: 'Zero leaf, waste, or guard-bonfire burning',
        detail: 'Provide enclosed warm layers/electric heaters for night guards and compost dry leaves instead of burning.',
        impactTag: 'Prevents toxic local smoke'
      },
      {
        id: 'rwa_clean_room',
        title: 'Designate one shared clean-air community room',
        detail: 'Keep a clubhouse or lounge sealed with HEPA filtration for seniors and children during severe AQI hours.',
        impactTag: 'Protects vulnerable residents'
      },
      {
        id: 'rwa_construction',
        title: 'Cover construction dust & wet-sweep roads',
        detail: 'Mandate green mesh covers, water sprinkling, and damp sweeping instead of dry brooming.',
        impactTag: 'Reduces coarse dust resuspension'
      },
      {
        id: 'rwa_carpool',
        title: 'Start a society metro-feeder & carpool group',
        detail: 'Coordinate shared rides to nearby metro stations and offices on Poor+ AQI days.',
        impactTag: 'Lowers daily vehicle trips'
      }
    ]
  },
  school: {
    label: 'School & Parent Group',
    intro: 'Practical coordination for principals, bus operators, and parents during winter smog.',
    actions: [
      {
        id: 'school_no_idling',
        title: 'Switch off engines during school pickup queues',
        detail: 'Keep school buses and parent vehicles engine-off near classrooms and playgrounds.',
        impactTag: 'Protects children from exhaust'
      },
      {
        id: 'school_indoor_play',
        title: 'Shift morning assembly and PT indoors above AQI 200',
        detail: 'Move strenuous outdoor sports to midday low-PM windows or indoor halls when CPCB AQI exceeds 200.',
        impactTag: 'Cuts peak exertion exposure'
      },
      {
        id: 'school_classroom',
        title: 'Use HEPA or DIY box-fan filtration in junior classrooms',
        detail: 'Pair closed windows during morning inversions with portable filtration and wet-mopped floors.',
        impactTag: 'Cleaner indoor learning air'
      },
      {
        id: 'school_pool',
        title: 'Organize neighbourhood walking-bus or shared vans on good days',
        detail: 'Replace solo car drop-offs with shared transport, reserving active trips for low-AQI afternoons.',
        impactTag: 'Reduces gate congestion'
      }
    ]
  },
  workplace: {
    label: 'Workplace / Office',
    intro: 'Employer and commuter team steps that reduce both emissions and peak-hour exposure.',
    actions: [
      {
        id: 'work_hybrid',
        title: 'Trigger remote/hybrid days when city AQI crosses 300',
        detail: 'Eliminate non-essential peak-hour commutes during Very Poor and Severe winter smog episodes.',
        impactTag: 'Zero commute CO2 & exposure'
      },
      {
        id: 'work_stagger',
        title: 'Offer staggered hours outside morning/evening inversion peaks',
        detail: 'Allow commuters to travel closer to midday dispersion windows when PM2.5 concentrations dip.',
        impactTag: 'Lowers commute exposure'
      },
      {
        id: 'work_metro',
        title: 'Incentivize Metro / bus passes and shuttle feeders',
        detail: 'Connect office campuses to the nearest metro station with shared e-shuttles.',
        impactTag: 'Cuts solo car emissions'
      },
      {
        id: 'work_hvac',
        title: 'Upgrade office HVAC to MERV-13+ filters & check intake timings',
        detail: 'Recirculate filtered air during morning smog spikes and bring in fresh air during afternoon dips.',
        impactTag: 'Improves indoor workplace air'
      }
    ]
  }
};

export const SDGS = [
  {
    code: 'SDG 3',
    title: 'Good Health & Well-being',
    detail: 'Reduces acute particulate exposure for children, seniors, pregnant women, and people with respiratory conditions.'
  },
  {
    code: 'SDG 11',
    title: 'Sustainable Cities & Communities',
    detail: 'Connects households, schools, and RWAs around metro transit, no-idling zones, and clean-air community rooms.'
  },
  {
    code: 'SDG 13',
    title: 'Climate Action',
    detail: 'Quantifies CO2 avoided from everyday transport switches so families see the climate value of each decision.'
  }
];

export const SMOG_SCIENCE = [
  {
    title: 'Why winter smog peaks at dawn & night',
    detail: 'Cool ground-level air gets trapped beneath a warmer lid (temperature inversion) with weak winds, concentrating PM2.5 near street level until midday sun warms the surface.'
  },
  {
    title: 'Major urban & regional sources',
    detail: 'Tailpipe exhaust, road dust, biomass/solid-fuel cooking, waste burning, diesel generators, and regional crop-residue smoke accumulate rapidly during calm winter weather.'
  },
  {
    title: 'Exposure vs. emissions matters',
    detail: 'Cycling cuts CO2 to zero, yet heavy breathing along congested roads during Severe AQI increases inhaled particles. Saans balances both dimensions before advising.'
  }
];
