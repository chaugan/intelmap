export const DEFAULT_CENTER = { longitude: 18.5, latitude: 69.0 };
export const DEFAULT_ZOOM = 8;

export const BASE_LAYERS = {
  topo: {
    id: 'topo',
    name: 'Kartverket Topo',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
  },
  grayscale: {
    id: 'grayscale',
    name: 'Kartverket Gråtone',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png',
  },
  toporaster: {
    id: 'toporaster',
    name: 'Kartverket Raster',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
  },
  osm: {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
};

export const COMMON_SIDCS = {
  friendly: [
    { sidc: 'SFGPUCI----H---', name: 'Infanteribataljon', nameEn: 'Infantry Battalion' },
    { sidc: 'SFGPUCA----H---', name: 'Panserbataljon', nameEn: 'Armor Battalion' },
    { sidc: 'SFGPUCF----G---', name: 'Artilleribatteri', nameEn: 'Artillery Battery' },
    { sidc: 'SFGPUCRR---G---', name: 'Oppklaringskompani', nameEn: 'Recon Company' },
    { sidc: 'SFGPUCE----G---', name: 'Ingeniørkompani', nameEn: 'Engineer Company' },
    { sidc: 'SFGPUH-----F---', name: 'HQ Brigade', nameEn: 'HQ Brigade' },
    { sidc: 'SFGPUCI----G---', name: 'Infanterikompani', nameEn: 'Infantry Company' },
    { sidc: 'SFGPUCAA---G---', name: 'Luftvern', nameEn: 'Air Defense' },
    { sidc: 'SFGPUSS----G---', name: 'Forsyning', nameEn: 'Supply' },
    { sidc: 'SFGPUST----G---', name: 'Sanitet', nameEn: 'Medical' },
  ],
  hostile: [
    { sidc: 'SHGPUCI----H---', name: 'Infanteribataljon', nameEn: 'Infantry Battalion' },
    { sidc: 'SHGPUCA----H---', name: 'Panserbataljon', nameEn: 'Armor Battalion' },
    { sidc: 'SHGPUCF----G---', name: 'Artilleribatteri', nameEn: 'Artillery Battery' },
    { sidc: 'SHGPUCRR---G---', name: 'Oppklaringskompani', nameEn: 'Recon Company' },
    { sidc: 'SHGPUCE----G---', name: 'Ingeniørkompani', nameEn: 'Engineer Company' },
    { sidc: 'SHGPUH-----F---', name: 'HQ Brigade', nameEn: 'HQ Brigade' },
    { sidc: 'SHGPUCI----G---', name: 'Infanterikompani', nameEn: 'Infantry Company' },
    { sidc: 'SHGPUCIZ---H---', name: 'Mek. infanteribataljon', nameEn: 'Mech. Infantry Btn' },
  ],
  neutral: [
    { sidc: 'SNGPUCI----H---', name: 'Infanteribataljon', nameEn: 'Infantry Battalion' },
    { sidc: 'SNGPUCA----H---', name: 'Panserbataljon', nameEn: 'Armor Battalion' },
  ],
};

// Extended military symbol categories with friendly/hostile/neutral variants
export const SYMBOL_CATEGORIES = {
  infantry: {
    name: { en: 'Infantry', no: 'Infanteri' },
    friendly: [
      { sidc: 'SFGPUCI----A---', name: { en: 'Infantry Team', no: 'Infanterilag' } },
      { sidc: 'SFGPUCI----B---', name: { en: 'Infantry Squad', no: 'Infanteritropp' } },
      { sidc: 'SFGPUCI----D---', name: { en: 'Infantry Platoon', no: 'Infanteripluton' } },
      { sidc: 'SFGPUCI----G---', name: { en: 'Infantry Company', no: 'Infanterikompani' } },
      { sidc: 'SFGPUCI----H---', name: { en: 'Infantry Battalion', no: 'Infanteribataljon' } },
      { sidc: 'SFGPUCI----I---', name: { en: 'Infantry Regiment', no: 'Infanteriregiment' } },
      { sidc: 'SFGPUCIZ---G---', name: { en: 'Mech. Infantry Company', no: 'Mek. infanterikompani' } },
      { sidc: 'SFGPUCIZ---H---', name: { en: 'Mech. Infantry Battalion', no: 'Mek. infanteribataljon' } },
      { sidc: 'SFGPUCIM---G---', name: { en: 'Motorized Infantry Company', no: 'Motorisert infanterikompani' } },
      { sidc: 'SFGPUCIM---H---', name: { en: 'Motorized Infantry Battalion', no: 'Motorisert infanteribataljon' } },
    ],
    hostile: [
      { sidc: 'SHGPUCI----B---', name: { en: 'Infantry Squad', no: 'Infanteritropp' } },
      { sidc: 'SHGPUCI----D---', name: { en: 'Infantry Platoon', no: 'Infanteripluton' } },
      { sidc: 'SHGPUCI----G---', name: { en: 'Infantry Company', no: 'Infanterikompani' } },
      { sidc: 'SHGPUCI----H---', name: { en: 'Infantry Battalion', no: 'Infanteribataljon' } },
      { sidc: 'SHGPUCI----I---', name: { en: 'Infantry Regiment', no: 'Infanteriregiment' } },
      { sidc: 'SHGPUCIZ---G---', name: { en: 'Mech. Infantry Company', no: 'Mek. infanterikompani' } },
      { sidc: 'SHGPUCIZ---H---', name: { en: 'Mech. Infantry Battalion', no: 'Mek. infanteribataljon' } },
      { sidc: 'SHGPUCIM---G---', name: { en: 'Motorized Infantry Company', no: 'Motorisert infanterikompani' } },
      { sidc: 'SHGPUCIM---H---', name: { en: 'Motorized Infantry Battalion', no: 'Motorisert infanteribataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUCI----G---', name: { en: 'Infantry Company', no: 'Infanterikompani' } },
      { sidc: 'SNGPUCI----H---', name: { en: 'Infantry Battalion', no: 'Infanteribataljon' } },
    ],
  },
  armor: {
    name: { en: 'Armor', no: 'Panser' },
    friendly: [
      { sidc: 'SFGPUCA----D---', name: { en: 'Armor Platoon', no: 'Panserpluton' } },
      { sidc: 'SFGPUCA----G---', name: { en: 'Armor Company', no: 'Panserkompani' } },
      { sidc: 'SFGPUCA----H---', name: { en: 'Armor Battalion', no: 'Panserbataljon' } },
      { sidc: 'SFGPUCA----I---', name: { en: 'Armor Regiment', no: 'Panserregiment' } },
      { sidc: 'SFGPUCAW---G---', name: { en: 'Wheeled Armor Company', no: 'Hjulpanserkompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCA----D---', name: { en: 'Armor Platoon', no: 'Panserpluton' } },
      { sidc: 'SHGPUCA----G---', name: { en: 'Armor Company', no: 'Panserkompani' } },
      { sidc: 'SHGPUCA----H---', name: { en: 'Armor Battalion', no: 'Panserbataljon' } },
      { sidc: 'SHGPUCA----I---', name: { en: 'Armor Regiment', no: 'Panserregiment' } },
    ],
    neutral: [
      { sidc: 'SNGPUCA----G---', name: { en: 'Armor Company', no: 'Panserkompani' } },
      { sidc: 'SNGPUCA----H---', name: { en: 'Armor Battalion', no: 'Panserbataljon' } },
    ],
  },
  artillery: {
    name: { en: 'Artillery', no: 'Artilleri' },
    friendly: [
      { sidc: 'SFGPUCF----D---', name: { en: 'Artillery Platoon', no: 'Artilleripluton' } },
      { sidc: 'SFGPUCF----G---', name: { en: 'Artillery Battery', no: 'Artilleribatteri' } },
      { sidc: 'SFGPUCF----H---', name: { en: 'Artillery Battalion', no: 'Artilleribataljon' } },
      { sidc: 'SFGPUCFR---G---', name: { en: 'Rocket Artillery Battery', no: 'Rakettartilleribatteri' } },
      { sidc: 'SFGPUCFM---G---', name: { en: 'Mortar Battery', no: 'Bombekasterbatteri' } },
      { sidc: 'SFGPUCFM---D---', name: { en: 'Mortar Platoon', no: 'Bombekasterpluton' } },
      { sidc: 'SFGPUCFS---G---', name: { en: 'SP Artillery Battery', no: 'Selvdrevet artilleribatteri' } },
    ],
    hostile: [
      { sidc: 'SHGPUCF----G---', name: { en: 'Artillery Battery', no: 'Artilleribatteri' } },
      { sidc: 'SHGPUCF----H---', name: { en: 'Artillery Battalion', no: 'Artilleribataljon' } },
      { sidc: 'SHGPUCFR---G---', name: { en: 'Rocket Artillery Battery', no: 'Rakettartilleribatteri' } },
      { sidc: 'SHGPUCFM---G---', name: { en: 'Mortar Battery', no: 'Bombekasterbatteri' } },
    ],
    neutral: [
      { sidc: 'SNGPUCF----G---', name: { en: 'Artillery Battery', no: 'Artilleribatteri' } },
      { sidc: 'SNGPUCF----H---', name: { en: 'Artillery Battalion', no: 'Artilleribataljon' } },
    ],
  },
  airDefense: {
    name: { en: 'Air Defense', no: 'Luftvern' },
    friendly: [
      { sidc: 'SFGPUCAA---D---', name: { en: 'AD Platoon', no: 'Luftvernpluton' } },
      { sidc: 'SFGPUCAA---G---', name: { en: 'AD Battery', no: 'Luftvernbatteri' } },
      { sidc: 'SFGPUCAA---H---', name: { en: 'AD Battalion', no: 'Luftvernbataljon' } },
      { sidc: 'SFGPUCAAM--G---', name: { en: 'AD Missile Battery', no: 'Luftvern missilbatteri' } },
    ],
    hostile: [
      { sidc: 'SHGPUCAA---G---', name: { en: 'AD Battery', no: 'Luftvernbatteri' } },
      { sidc: 'SHGPUCAA---H---', name: { en: 'AD Battalion', no: 'Luftvernbataljon' } },
      { sidc: 'SHGPUCAAM--G---', name: { en: 'AD Missile Battery', no: 'Luftvern missilbatteri' } },
    ],
    neutral: [
      { sidc: 'SNGPUCAA---G---', name: { en: 'AD Battery', no: 'Luftvernbatteri' } },
    ],
  },
  aviation: {
    name: { en: 'Aviation', no: 'Luftmobile' },
    friendly: [
      { sidc: 'SFGPUCV----G---', name: { en: 'Aviation Company', no: 'Helikopterkompani' } },
      { sidc: 'SFGPUCV----H---', name: { en: 'Aviation Battalion', no: 'Helikopterbataljon' } },
      { sidc: 'SFGPUCVA---G---', name: { en: 'Attack Aviation Company', no: 'Angrepshelikopterkompani' } },
      { sidc: 'SFGPUCVR---G---', name: { en: 'Recon Aviation Company', no: 'Oppklaringshelikopterkompani' } },
      { sidc: 'SFGPUCVU---G---', name: { en: 'Utility Aviation Company', no: 'Transporthelikopterkompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCV----G---', name: { en: 'Aviation Company', no: 'Helikopterkompani' } },
      { sidc: 'SHGPUCV----H---', name: { en: 'Aviation Battalion', no: 'Helikopterbataljon' } },
      { sidc: 'SHGPUCVA---G---', name: { en: 'Attack Aviation Company', no: 'Angrepshelikopterkompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUCV----G---', name: { en: 'Aviation Company', no: 'Helikopterkompani' } },
    ],
  },
  engineer: {
    name: { en: 'Engineer', no: 'Ingeniør' },
    friendly: [
      { sidc: 'SFGPUCE----D---', name: { en: 'Engineer Platoon', no: 'Ingeniørpluton' } },
      { sidc: 'SFGPUCE----G---', name: { en: 'Engineer Company', no: 'Ingeniørkompani' } },
      { sidc: 'SFGPUCE----H---', name: { en: 'Engineer Battalion', no: 'Ingeniørbataljon' } },
      { sidc: 'SFGPUCEC---G---', name: { en: 'Combat Engineer Company', no: 'Stridsingeniørkompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCE----G---', name: { en: 'Engineer Company', no: 'Ingeniørkompani' } },
      { sidc: 'SHGPUCE----H---', name: { en: 'Engineer Battalion', no: 'Ingeniørbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUCE----G---', name: { en: 'Engineer Company', no: 'Ingeniørkompani' } },
    ],
  },
  recon: {
    name: { en: 'Reconnaissance', no: 'Oppklaring' },
    friendly: [
      { sidc: 'SFGPUCRR---D---', name: { en: 'Recon Platoon', no: 'Oppklaringspluton' } },
      { sidc: 'SFGPUCRR---G---', name: { en: 'Recon Company', no: 'Oppklaringskompani' } },
      { sidc: 'SFGPUCRR---H---', name: { en: 'Recon Battalion', no: 'Oppklaringsbataljon' } },
      { sidc: 'SFGPUCRRA--G---', name: { en: 'Armored Recon Company', no: 'Pansret oppklaringskompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCRR---D---', name: { en: 'Recon Platoon', no: 'Oppklaringspluton' } },
      { sidc: 'SHGPUCRR---G---', name: { en: 'Recon Company', no: 'Oppklaringskompani' } },
      { sidc: 'SHGPUCRR---H---', name: { en: 'Recon Battalion', no: 'Oppklaringsbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUCRR---G---', name: { en: 'Recon Company', no: 'Oppklaringskompani' } },
    ],
  },
  logistics: {
    name: { en: 'Logistics', no: 'Logistikk' },
    friendly: [
      { sidc: 'SFGPUSS----G---', name: { en: 'Supply Company', no: 'Forsyningskompani' } },
      { sidc: 'SFGPUSS----H---', name: { en: 'Supply Battalion', no: 'Forsyningsbataljon' } },
      { sidc: 'SFGPUST----G---', name: { en: 'Transport Company', no: 'Transportkompani' } },
      { sidc: 'SFGPUST----H---', name: { en: 'Transport Battalion', no: 'Transportbataljon' } },
      { sidc: 'SFGPUSM----G---', name: { en: 'Maintenance Company', no: 'Vedlikeholdskompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUSS----G---', name: { en: 'Supply Company', no: 'Forsyningskompani' } },
      { sidc: 'SHGPUSS----H---', name: { en: 'Supply Battalion', no: 'Forsyningsbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUSS----G---', name: { en: 'Supply Company', no: 'Forsyningskompani' } },
    ],
  },
  medical: {
    name: { en: 'Medical', no: 'Sanitet' },
    friendly: [
      { sidc: 'SFGPUSM----D---', name: { en: 'Medical Platoon', no: 'Sanitetspluton' } },
      { sidc: 'SFGPUSM----G---', name: { en: 'Medical Company', no: 'Sanitetskompani' } },
      { sidc: 'SFGPUSM----H---', name: { en: 'Medical Battalion', no: 'Sanitetsbataljon' } },
    ],
    hostile: [
      { sidc: 'SHGPUSM----G---', name: { en: 'Medical Company', no: 'Sanitetskompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUSM----G---', name: { en: 'Medical Company', no: 'Sanitetskompani' } },
    ],
  },
  hqCommand: {
    name: { en: 'HQ / Command', no: 'Stab / Kommando' },
    friendly: [
      { sidc: 'SFGPUH-----E---', name: { en: 'HQ Battalion', no: 'Stab bataljon' } },
      { sidc: 'SFGPUH-----F---', name: { en: 'HQ Brigade', no: 'Stab brigade' } },
      { sidc: 'SFGPUH-----G---', name: { en: 'HQ Division', no: 'Stab divisjon' } },
      { sidc: 'SFGPUH-----H---', name: { en: 'HQ Corps', no: 'Stab korps' } },
    ],
    hostile: [
      { sidc: 'SHGPUH-----E---', name: { en: 'HQ Battalion', no: 'Stab bataljon' } },
      { sidc: 'SHGPUH-----F---', name: { en: 'HQ Brigade', no: 'Stab brigade' } },
      { sidc: 'SHGPUH-----G---', name: { en: 'HQ Division', no: 'Stab divisjon' } },
    ],
    neutral: [
      { sidc: 'SNGPUH-----F---', name: { en: 'HQ Brigade', no: 'Stab brigade' } },
    ],
  },
  signalComms: {
    name: { en: 'Signal / Comms', no: 'Samband' },
    friendly: [
      { sidc: 'SFGPUUS----D---', name: { en: 'Signal Platoon', no: 'Sambandspluton' } },
      { sidc: 'SFGPUUS----G---', name: { en: 'Signal Company', no: 'Sambandskompani' } },
      { sidc: 'SFGPUUS----H---', name: { en: 'Signal Battalion', no: 'Sambandsbataljon' } },
    ],
    hostile: [
      { sidc: 'SHGPUUS----G---', name: { en: 'Signal Company', no: 'Sambandskompani' } },
      { sidc: 'SHGPUUS----H---', name: { en: 'Signal Battalion', no: 'Sambandsbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUUS----G---', name: { en: 'Signal Company', no: 'Sambandskompani' } },
    ],
  },
  specialForces: {
    name: { en: 'Special Forces', no: 'Spesialstyrker' },
    friendly: [
      { sidc: 'SFGPUCSM---B---', name: { en: 'SF Team', no: 'Spesialstyrketeam' } },
      { sidc: 'SFGPUCSM---D---', name: { en: 'SF Platoon', no: 'Spesialstyrketropp' } },
      { sidc: 'SFGPUCSM---G---', name: { en: 'SF Company', no: 'Spesialstyrkeenhet' } },
    ],
    hostile: [
      { sidc: 'SHGPUCSM---B---', name: { en: 'SF Team', no: 'Spesialstyrketeam' } },
      { sidc: 'SHGPUCSM---G---', name: { en: 'SF Company', no: 'Spesialstyrkeenhet' } },
    ],
    neutral: [
      { sidc: 'SNGPUCSM---G---', name: { en: 'SF Company', no: 'Spesialstyrkeenhet' } },
    ],
  },
  obstacles: {
    name: { en: 'Obstacles', no: 'Hindringer' },
    friendly: [
      { sidc: 'SFGPEXM----H---', name: { en: 'Minefield', no: 'Minefelt' } },
      { sidc: 'SFGPEXMC---H---', name: { en: 'AT Minefield', no: 'PV-minefelt' } },
      { sidc: 'SFGPEXMA---H---', name: { en: 'AP Minefield', no: 'AP-minefelt' } },
    ],
    hostile: [
      { sidc: 'SHGPEXM----H---', name: { en: 'Minefield', no: 'Minefelt' } },
      { sidc: 'SHGPEXMC---H---', name: { en: 'AT Minefield', no: 'PV-minefelt' } },
      { sidc: 'SHGPEXMA---H---', name: { en: 'AP Minefield', no: 'AP-minefelt' } },
    ],
    neutral: [
      { sidc: 'SNGPEXM----H---', name: { en: 'Minefield', no: 'Minefelt' } },
    ],
  },
  naval: {
    name: { en: 'Naval', no: 'Marine' },
    friendly: [
      { sidc: 'SFSPCLFF---H---', name: { en: 'Frigate', no: 'Fregatt' } },
      { sidc: 'SFSPCLCV---H---', name: { en: 'Corvette', no: 'Korvett' } },
      { sidc: 'SFSPCLL----H---', name: { en: 'Landing Ship', no: 'Landgangsfartøy' } },
      { sidc: 'SFSPCLSS---H---', name: { en: 'Submarine', no: 'Ubåt' } },
      { sidc: 'SFSPCLP----H---', name: { en: 'Patrol Boat', no: 'Patruljebåt' } },
    ],
    hostile: [
      { sidc: 'SHSPCLFF---H---', name: { en: 'Frigate', no: 'Fregatt' } },
      { sidc: 'SHSPCLCV---H---', name: { en: 'Corvette', no: 'Korvett' } },
      { sidc: 'SHSPCLSS---H---', name: { en: 'Submarine', no: 'Ubåt' } },
      { sidc: 'SHSPCLL----H---', name: { en: 'Landing Ship', no: 'Landgangsfartøy' } },
    ],
    neutral: [
      { sidc: 'SNSPCLFF---H---', name: { en: 'Frigate', no: 'Fregatt' } },
      { sidc: 'SNSPCLSS---H---', name: { en: 'Submarine', no: 'Ubåt' } },
    ],
  },
  cbrn: {
    name: { en: 'CBRN', no: 'CBRN' },
    friendly: [
      { sidc: 'SFGPUCR----D---', name: { en: 'CBRN Platoon', no: 'CBRN-pluton' } },
      { sidc: 'SFGPUCR----G---', name: { en: 'CBRN Company', no: 'CBRN-kompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCR----G---', name: { en: 'CBRN Company', no: 'CBRN-kompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUCR----G---', name: { en: 'CBRN Company', no: 'CBRN-kompani' } },
    ],
  },
};

export const DRAW_COLORS = [
  { id: 'blue', color: '#3b82f6', label: 'Vennlig', labelEn: 'Friendly' },
  { id: 'red', color: '#ef4444', label: 'Fiendtlig', labelEn: 'Hostile' },
  { id: 'green', color: '#22c55e', label: 'Nøytral', labelEn: 'Neutral' },
  { id: 'black', color: '#1e293b', label: 'Svart', labelEn: 'Black' },
];
