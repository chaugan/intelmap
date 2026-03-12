export const DEFAULT_CENTER = { longitude: 15.0, latitude: 65.0 };
export const DEFAULT_ZOOM = 5;

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
    variant: true,
  },
  topo_night: {
    id: 'topo_night',
    name: 'Topo Nattmodus',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    nightMode: true,
    variant: true,
  },
  toporaster: {
    id: 'toporaster',
    name: 'Kartverket Raster',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
  },
  toporaster_gray: {
    id: 'toporaster_gray',
    name: 'Raster Gråtone',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
    grayscale: true,
  },
  toporaster_night: {
    id: 'toporaster_night',
    name: 'Raster Nattmodus',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
    nightMode: true,
    variant: true,
  },
  osm: {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
  osm_gray: {
    id: 'osm_gray',
    name: 'OSM Gråtone',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    grayscale: true,
  },
  osm_night: {
    id: 'osm_night',
    name: 'OSM Nattmodus',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    nightMode: true,
    variant: true,
  },
  satellite: {
    id: 'satellite',
    name: 'Esri Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  satellite_gray: {
    id: 'satellite_gray',
    name: 'Satellite Gråtone',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    grayscale: true,
  },
  satellite_night: {
    id: 'satellite_night',
    name: 'Satellite Nattmodus',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    nightMode: true,
    variant: true,
  },
};

export const COMMON_SIDCS = {
  friendly: [
    { sidc: 'SFGPUCI----F---', name: 'Infanteribataljon', nameEn: 'Infantry Battalion' },
    { sidc: 'SFGPUCA----F---', name: 'Panserbataljon', nameEn: 'Armor Battalion' },
    { sidc: 'SFGPUCF----E---', name: 'Artilleribatteri', nameEn: 'Artillery Battery' },
    { sidc: 'SFGPUCRR---E---', name: 'Oppklaringskompani', nameEn: 'Recon Company' },
    { sidc: 'SFGPUCE----E---', name: 'Ingeniørkompani', nameEn: 'Engineer Company' },
    { sidc: 'SFGPUH-----H---', name: 'HQ Brigade', nameEn: 'HQ Brigade' },
    { sidc: 'SFGPUCI----E---', name: 'Infanterikompani', nameEn: 'Infantry Company' },
    { sidc: 'SFGPUCAA---E---', name: 'Luftvern', nameEn: 'Air Defense' },
    { sidc: 'SFGPUSS----E---', name: 'Forsyning', nameEn: 'Supply' },
    { sidc: 'SFGPUST----E---', name: 'Sanitet', nameEn: 'Medical' },
  ],
  hostile: [
    { sidc: 'SHGPUCI----F---', name: 'Infanteribataljon', nameEn: 'Infantry Battalion' },
    { sidc: 'SHGPUCA----F---', name: 'Panserbataljon', nameEn: 'Armor Battalion' },
    { sidc: 'SHGPUCF----E---', name: 'Artilleribatteri', nameEn: 'Artillery Battery' },
    { sidc: 'SHGPUCRR---E---', name: 'Oppklaringskompani', nameEn: 'Recon Company' },
    { sidc: 'SHGPUCE----E---', name: 'Ingeniørkompani', nameEn: 'Engineer Company' },
    { sidc: 'SHGPUH-----H---', name: 'HQ Brigade', nameEn: 'HQ Brigade' },
    { sidc: 'SHGPUCI----E---', name: 'Infanterikompani', nameEn: 'Infantry Company' },
    { sidc: 'SHGPUCIZ---F---', name: 'Mek. infanteribataljon', nameEn: 'Mech. Infantry Btn' },
  ],
  neutral: [
    { sidc: 'SNGPUCI----F---', name: 'Infanteribataljon', nameEn: 'Infantry Battalion' },
    { sidc: 'SNGPUCA----F---', name: 'Panserbataljon', nameEn: 'Armor Battalion' },
  ],
};

// Echelon codes for MIL-STD-2525C (character at position 11 in SIDC)
export const ECHELONS = [
  { code: '-', name: { en: 'Unknown', no: 'Ukjent' }, symbol: '?' },
  { code: 'A', name: { en: 'Team/Crew', no: 'Lag' }, symbol: '\u00d8' },
  { code: 'B', name: { en: 'Squad', no: 'Tropp' }, symbol: '\u2022\u2022' },
  { code: 'D', name: { en: 'Platoon', no: 'Pluton' }, symbol: '\u2022\u2022\u2022' },
  { code: 'E', name: { en: 'Company/Battery', no: 'Kompani/Batteri' }, symbol: '|' },
  { code: 'F', name: { en: 'Battalion', no: 'Bataljon' }, symbol: '||' },
  { code: 'G', name: { en: 'Regiment/Group', no: 'Regiment' }, symbol: '|||' },
  { code: 'H', name: { en: 'Brigade', no: 'Brigade' }, symbol: 'X' },
  { code: 'I', name: { en: 'Division', no: 'Divisjon' }, symbol: 'XX' },
  { code: 'J', name: { en: 'Corps', no: 'Korps' }, symbol: 'XXX' },
];

// Extended military symbol categories with friendly/hostile/neutral variants
// Echelon codes: A=Team, B=Squad, D=Platoon, E=Company, F=Battalion, G=Regiment, H=Brigade, I=Division, J=Corps
export const SYMBOL_CATEGORIES = {
  infantry: {
    name: { en: 'Infantry', no: 'Infanteri' },
    friendly: [
      { sidc: 'SFGPUCI----A---', name: { en: 'Infantry Team', no: 'Infanterilag' } },
      { sidc: 'SFGPUCI----B---', name: { en: 'Infantry Squad', no: 'Infanteritropp' } },
      { sidc: 'SFGPUCI----E---', name: { en: 'Infantry Company', no: 'Infanterikompani' } },
      { sidc: 'SFGPUCI----F---', name: { en: 'Infantry Battalion', no: 'Infanteribataljon' } },
      { sidc: 'SFGPUCI----G---', name: { en: 'Infantry Regiment', no: 'Infanteriregiment' } },
      { sidc: 'SFGPUCIZ---E---', name: { en: 'Mech. Infantry Company', no: 'Mek. infanterikompani' } },
      { sidc: 'SFGPUCIZ---F---', name: { en: 'Mech. Infantry Battalion', no: 'Mek. infanteribataljon' } },
      { sidc: 'SFGPUCIM---E---', name: { en: 'Motorized Infantry Company', no: 'Motorisert infanterikompani' } },
      { sidc: 'SFGPUCIM---F---', name: { en: 'Motorized Infantry Battalion', no: 'Motorisert infanteribataljon' } },
    ],
    hostile: [
      { sidc: 'SHGPUCI----B---', name: { en: 'Infantry Squad', no: 'Infanteritropp' } },
      { sidc: 'SHGPUCI----E---', name: { en: 'Infantry Company', no: 'Infanterikompani' } },
      { sidc: 'SHGPUCI----F---', name: { en: 'Infantry Battalion', no: 'Infanteribataljon' } },
      { sidc: 'SHGPUCI----G---', name: { en: 'Infantry Regiment', no: 'Infanteriregiment' } },
      { sidc: 'SHGPUCIZ---E---', name: { en: 'Mech. Infantry Company', no: 'Mek. infanterikompani' } },
      { sidc: 'SHGPUCIZ---F---', name: { en: 'Mech. Infantry Battalion', no: 'Mek. infanteribataljon' } },
      { sidc: 'SHGPUCIM---E---', name: { en: 'Motorized Infantry Company', no: 'Motorisert infanterikompani' } },
      { sidc: 'SHGPUCIM---F---', name: { en: 'Motorized Infantry Battalion', no: 'Motorisert infanteribataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUCI----E---', name: { en: 'Infantry Company', no: 'Infanterikompani' } },
      { sidc: 'SNGPUCI----F---', name: { en: 'Infantry Battalion', no: 'Infanteribataljon' } },
    ],
  },
  armor: {
    name: { en: 'Armor', no: 'Panser' },
    friendly: [
      { sidc: 'SFGPUCA----B---', name: { en: 'Armor Squad', no: 'Pansertropp' } },
      { sidc: 'SFGPUCA----E---', name: { en: 'Armor Squadron', no: 'Pansereskadron' } },
      { sidc: 'SFGPUCA----F---', name: { en: 'Armor Battalion', no: 'Panserbataljon' } },
      { sidc: 'SFGPUCA----G---', name: { en: 'Armor Regiment', no: 'Panserregiment' } },
      { sidc: 'SFGPUCAW---E---', name: { en: 'Wheeled Armor Squadron', no: 'Hjulpansereskadron' } },
    ],
    hostile: [
      { sidc: 'SHGPUCA----B---', name: { en: 'Armor Squad', no: 'Pansertropp' } },
      { sidc: 'SHGPUCA----E---', name: { en: 'Armor Squadron', no: 'Pansereskadron' } },
      { sidc: 'SHGPUCA----F---', name: { en: 'Armor Battalion', no: 'Panserbataljon' } },
      { sidc: 'SHGPUCA----G---', name: { en: 'Armor Regiment', no: 'Panserregiment' } },
    ],
    neutral: [
      { sidc: 'SNGPUCA----E---', name: { en: 'Armor Squadron', no: 'Pansereskadron' } },
      { sidc: 'SNGPUCA----F---', name: { en: 'Armor Battalion', no: 'Panserbataljon' } },
    ],
  },
  artillery: {
    name: { en: 'Artillery', no: 'Artilleri' },
    friendly: [
      { sidc: 'SFGPUCF----B---', name: { en: 'Artillery Squad', no: 'Artilleritropp' } },
      { sidc: 'SFGPUCF----E---', name: { en: 'Artillery Battery', no: 'Artilleribatteri' } },
      { sidc: 'SFGPUCF----F---', name: { en: 'Artillery Battalion', no: 'Artilleribataljon' } },
      { sidc: 'SFGPUCFR---E---', name: { en: 'Rocket Artillery Battery', no: 'Rakettartilleribatteri' } },
      { sidc: 'SFGPUCFM---E---', name: { en: 'Mortar Battery', no: 'Bombekasterbatteri' } },
      { sidc: 'SFGPUCFM---B---', name: { en: 'Mortar Squad', no: 'Bombekastertropp' } },
      { sidc: 'SFGPUCFS---E---', name: { en: 'SP Artillery Battery', no: 'Selvdrevet artilleribatteri' } },
    ],
    hostile: [
      { sidc: 'SHGPUCF----E---', name: { en: 'Artillery Battery', no: 'Artilleribatteri' } },
      { sidc: 'SHGPUCF----F---', name: { en: 'Artillery Battalion', no: 'Artilleribataljon' } },
      { sidc: 'SHGPUCFR---E---', name: { en: 'Rocket Artillery Battery', no: 'Rakettartilleribatteri' } },
      { sidc: 'SHGPUCFM---E---', name: { en: 'Mortar Battery', no: 'Bombekasterbatteri' } },
    ],
    neutral: [
      { sidc: 'SNGPUCF----E---', name: { en: 'Artillery Battery', no: 'Artilleribatteri' } },
      { sidc: 'SNGPUCF----F---', name: { en: 'Artillery Battalion', no: 'Artilleribataljon' } },
    ],
  },
  airDefense: {
    name: { en: 'Air Defense', no: 'Luftvern' },
    friendly: [
      { sidc: 'SFGPUCAA---B---', name: { en: 'AD Squad', no: 'Luftverntropp' } },
      { sidc: 'SFGPUCAA---E---', name: { en: 'AD Battery', no: 'Luftvernbatteri' } },
      { sidc: 'SFGPUCAA---F---', name: { en: 'AD Battalion', no: 'Luftvernbataljon' } },
      { sidc: 'SFGPUCAAM--E---', name: { en: 'AD Missile Battery', no: 'Luftvern missilbatteri' } },
    ],
    hostile: [
      { sidc: 'SHGPUCAA---E---', name: { en: 'AD Battery', no: 'Luftvernbatteri' } },
      { sidc: 'SHGPUCAA---F---', name: { en: 'AD Battalion', no: 'Luftvernbataljon' } },
      { sidc: 'SHGPUCAAM--E---', name: { en: 'AD Missile Battery', no: 'Luftvern missilbatteri' } },
    ],
    neutral: [
      { sidc: 'SNGPUCAA---E---', name: { en: 'AD Battery', no: 'Luftvernbatteri' } },
    ],
  },
  aviation: {
    name: { en: 'Aviation', no: 'Luftmobile' },
    friendly: [
      { sidc: 'SFGPUCV----E---', name: { en: 'Aviation Company', no: 'Helikopterkompani' } },
      { sidc: 'SFGPUCV----F---', name: { en: 'Aviation Battalion', no: 'Helikopterbataljon' } },
      { sidc: 'SFGPUCVA---E---', name: { en: 'Attack Aviation Company', no: 'Angrepshelikopterkompani' } },
      { sidc: 'SFGPUCVR---E---', name: { en: 'Recon Aviation Company', no: 'Oppklaringshelikopterkompani' } },
      { sidc: 'SFGPUCVU---E---', name: { en: 'Utility Aviation Company', no: 'Transporthelikopterkompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCV----E---', name: { en: 'Aviation Company', no: 'Helikopterkompani' } },
      { sidc: 'SHGPUCV----F---', name: { en: 'Aviation Battalion', no: 'Helikopterbataljon' } },
      { sidc: 'SHGPUCVA---E---', name: { en: 'Attack Aviation Company', no: 'Angrepshelikopterkompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUCV----E---', name: { en: 'Aviation Company', no: 'Helikopterkompani' } },
    ],
  },
  engineer: {
    name: { en: 'Engineer', no: 'Ingeniør' },
    friendly: [
      { sidc: 'SFGPUCE----B---', name: { en: 'Engineer Squad', no: 'Ingeniørtropp' } },
      { sidc: 'SFGPUCE----E---', name: { en: 'Engineer Company', no: 'Ingeniørkompani' } },
      { sidc: 'SFGPUCE----F---', name: { en: 'Engineer Battalion', no: 'Ingeniørbataljon' } },
      { sidc: 'SFGPUCEC---E---', name: { en: 'Combat Engineer Company', no: 'Stridsingeniørkompani' } },
      { sidc: 'SFGPUCEB---E---', name: { en: 'Bridge Company', no: 'Brokompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCE----E---', name: { en: 'Engineer Company', no: 'Ingeniørkompani' } },
      { sidc: 'SHGPUCE----F---', name: { en: 'Engineer Battalion', no: 'Ingeniørbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUCE----E---', name: { en: 'Engineer Company', no: 'Ingeniørkompani' } },
    ],
  },
  recon: {
    name: { en: 'Reconnaissance', no: 'Oppklaring' },
    friendly: [
      { sidc: 'SFGPUCRR---B---', name: { en: 'Recon Squad', no: 'Oppklaringstropp' } },
      { sidc: 'SFGPUCRR---E---', name: { en: 'Recon Company', no: 'Oppklaringskompani' } },
      { sidc: 'SFGPUCRR---F---', name: { en: 'Recon Battalion', no: 'Oppklaringsbataljon' } },
      { sidc: 'SFGPUCRRA--E---', name: { en: 'Armored Recon Company', no: 'Pansret oppklaringskompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCRR---B---', name: { en: 'Recon Squad', no: 'Oppklaringstropp' } },
      { sidc: 'SHGPUCRR---E---', name: { en: 'Recon Company', no: 'Oppklaringskompani' } },
      { sidc: 'SHGPUCRR---F---', name: { en: 'Recon Battalion', no: 'Oppklaringsbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUCRR---E---', name: { en: 'Recon Company', no: 'Oppklaringskompani' } },
    ],
  },
  logistics: {
    name: { en: 'Logistics', no: 'Logistikk' },
    friendly: [
      { sidc: 'SFGPUSS----E---', name: { en: 'Supply Company', no: 'Forsyningskompani' } },
      { sidc: 'SFGPUSS----F---', name: { en: 'Supply Battalion', no: 'Forsyningsbataljon' } },
      { sidc: 'SFGPUST----E---', name: { en: 'Transport Company', no: 'Transportkompani' } },
      { sidc: 'SFGPUST----F---', name: { en: 'Transport Battalion', no: 'Transportbataljon' } },
      { sidc: 'SFGPUSM----E---', name: { en: 'Maintenance Company', no: 'Vedlikeholdskompani' } },
      { sidc: 'SFGPUSSA---E---', name: { en: 'Ammunition Supply Company', no: 'Ammunisjonskompani' } },
      { sidc: 'SFGPUSSF---E---', name: { en: 'Fuel Supply Company', no: 'Drivstoffkompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUSS----E---', name: { en: 'Supply Company', no: 'Forsyningskompani' } },
      { sidc: 'SHGPUSS----F---', name: { en: 'Supply Battalion', no: 'Forsyningsbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUSS----E---', name: { en: 'Supply Company', no: 'Forsyningskompani' } },
    ],
  },
  medical: {
    name: { en: 'Medical', no: 'Sanitet' },
    friendly: [
      { sidc: 'SFGPUSM----B---', name: { en: 'Medical Squad', no: 'Sanitetstropp' } },
      { sidc: 'SFGPUSM----E---', name: { en: 'Medical Company', no: 'Sanitetskompani' } },
      { sidc: 'SFGPUSM----F---', name: { en: 'Medical Battalion', no: 'Sanitetsbataljon' } },
    ],
    hostile: [
      { sidc: 'SHGPUSM----E---', name: { en: 'Medical Company', no: 'Sanitetskompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUSM----E---', name: { en: 'Medical Company', no: 'Sanitetskompani' } },
    ],
  },
  hqCommand: {
    name: { en: 'HQ / Command', no: 'Stab / Kommando' },
    friendly: [
      { sidc: 'SFGPUH-----F---', name: { en: 'HQ Battalion', no: 'Stab bataljon' } },
      { sidc: 'SFGPUH-----H---', name: { en: 'HQ Brigade', no: 'Stab brigade' } },
      { sidc: 'SFGPUH-----I---', name: { en: 'HQ Division', no: 'Stab divisjon' } },
      { sidc: 'SFGPUH-----J---', name: { en: 'HQ Corps', no: 'Stab korps' } },
    ],
    hostile: [
      { sidc: 'SHGPUH-----F---', name: { en: 'HQ Battalion', no: 'Stab bataljon' } },
      { sidc: 'SHGPUH-----H---', name: { en: 'HQ Brigade', no: 'Stab brigade' } },
      { sidc: 'SHGPUH-----I---', name: { en: 'HQ Division', no: 'Stab divisjon' } },
    ],
    neutral: [
      { sidc: 'SNGPUH-----H---', name: { en: 'HQ Brigade', no: 'Stab brigade' } },
    ],
  },
  signalComms: {
    name: { en: 'Signal / Comms', no: 'Samband' },
    friendly: [
      { sidc: 'SFGPUUS----B---', name: { en: 'Signal Squad', no: 'Sambandstropp' } },
      { sidc: 'SFGPUUS----E---', name: { en: 'Signal Company', no: 'Sambandskompani' } },
      { sidc: 'SFGPUUS----F---', name: { en: 'Signal Battalion', no: 'Sambandsbataljon' } },
    ],
    hostile: [
      { sidc: 'SHGPUUS----E---', name: { en: 'Signal Company', no: 'Sambandskompani' } },
      { sidc: 'SHGPUUS----F---', name: { en: 'Signal Battalion', no: 'Sambandsbataljon' } },
    ],
    neutral: [
      { sidc: 'SNGPUUS----E---', name: { en: 'Signal Company', no: 'Sambandskompani' } },
    ],
  },
  specialForces: {
    name: { en: 'Special Forces', no: 'Spesialstyrker' },
    friendly: [
      { sidc: 'SFGPUCSM---B---', name: { en: 'SF Team', no: 'Spesialstyrketeam' } },
      { sidc: 'SFGPUCSM---E---', name: { en: 'SF Company', no: 'Spesialstyrkeenhet' } },
    ],
    hostile: [
      { sidc: 'SHGPUCSM---B---', name: { en: 'SF Team', no: 'Spesialstyrketeam' } },
      { sidc: 'SHGPUCSM---E---', name: { en: 'SF Company', no: 'Spesialstyrkeenhet' } },
    ],
    neutral: [
      { sidc: 'SNGPUCSM---E---', name: { en: 'SF Company', no: 'Spesialstyrkeenhet' } },
    ],
  },
  militaryPolice: {
    name: { en: 'Military Police', no: 'Militærpoliti' },
    friendly: [
      { sidc: 'SFGPUCMP---B---', name: { en: 'MP Squad', no: 'Militærpolititropp' } },
      { sidc: 'SFGPUCMP---E---', name: { en: 'MP Company', no: 'Militærpolitikompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCMP---B---', name: { en: 'MP Squad', no: 'Militærpolititropp' } },
      { sidc: 'SHGPUCMP---E---', name: { en: 'MP Company', no: 'Militærpolitikompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUCMP---E---', name: { en: 'MP Company', no: 'Militærpolitikompani' } },
    ],
  },
  electronicWarfare: {
    name: { en: 'Electronic Warfare', no: 'Elektronisk krigføring' },
    friendly: [
      { sidc: 'SFGPUEW----B---', name: { en: 'EW Squad', no: 'EK-tropp' } },
      { sidc: 'SFGPUEW----E---', name: { en: 'EW Company', no: 'EK-kompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUEW----B---', name: { en: 'EW Squad', no: 'EK-tropp' } },
      { sidc: 'SHGPUEW----E---', name: { en: 'EW Company', no: 'EK-kompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUEW----E---', name: { en: 'EW Company', no: 'EK-kompani' } },
    ],
  },
  antiArmor: {
    name: { en: 'Anti-Armor', no: 'Panservern' },
    friendly: [
      { sidc: 'SFGPUCIA---B---', name: { en: 'Anti-Armor Squad', no: 'Panserverntropp' } },
      { sidc: 'SFGPUCIA---E---', name: { en: 'Anti-Armor Company', no: 'Panservernkompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCIA---B---', name: { en: 'Anti-Armor Squad', no: 'Panserverntropp' } },
      { sidc: 'SHGPUCIA---E---', name: { en: 'Anti-Armor Company', no: 'Panservernkompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUCIA---E---', name: { en: 'Anti-Armor Company', no: 'Panservernkompani' } },
    ],
  },
  airUnits: {
    name: { en: 'Air Units', no: 'Luftenheter' },
    friendly: [
      { sidc: 'SFAPMF-----E---', name: { en: 'Fighter Squadron', no: 'Jagerskvadron' } },
      { sidc: 'SFAPMFB----E---', name: { en: 'Bomber Squadron', no: 'Bomberskvadron' } },
      { sidc: 'SFAPMFT----E---', name: { en: 'Transport Squadron', no: 'Transportskvadron' } },
      { sidc: 'SFAPMU-----E---', name: { en: 'UAV Unit', no: 'UAV-enhet' } },
    ],
    hostile: [
      { sidc: 'SHAPMF-----E---', name: { en: 'Fighter Squadron', no: 'Jagerskvadron' } },
      { sidc: 'SHAPMFB----E---', name: { en: 'Bomber Squadron', no: 'Bomberskvadron' } },
      { sidc: 'SHAPMFT----E---', name: { en: 'Transport Squadron', no: 'Transportskvadron' } },
      { sidc: 'SHAPMU-----E---', name: { en: 'UAV Unit', no: 'UAV-enhet' } },
    ],
    neutral: [
      { sidc: 'SNAPMF-----E---', name: { en: 'Fighter Squadron', no: 'Jagerskvadron' } },
      { sidc: 'SNAPMU-----E---', name: { en: 'UAV Unit', no: 'UAV-enhet' } },
    ],
  },
  radarSensor: {
    name: { en: 'Radar / Sensor', no: 'Radar / Sensor' },
    friendly: [
      { sidc: 'SFGPUSR----B---', name: { en: 'Radar Squad', no: 'Radartropp' } },
      { sidc: 'SFGPUSR----E---', name: { en: 'Radar Company', no: 'Radarkompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUSR----B---', name: { en: 'Radar Squad', no: 'Radartropp' } },
      { sidc: 'SHGPUSR----E---', name: { en: 'Radar Company', no: 'Radarkompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUSR----E---', name: { en: 'Radar Company', no: 'Radarkompani' } },
    ],
  },
  observation: {
    name: { en: 'Observation', no: 'Observasjon' },
    friendly: [
      { sidc: 'SFGPUUO----A---', name: { en: 'Observation Post', no: 'Observasjonspost' } },
      { sidc: 'SFGPUCFO---A---', name: { en: 'Forward Observer', no: 'Fremskutt observatør' } },
    ],
    hostile: [
      { sidc: 'SHGPUUO----A---', name: { en: 'Observation Post', no: 'Observasjonspost' } },
      { sidc: 'SHGPUCFO---A---', name: { en: 'Forward Observer', no: 'Fremskutt observatør' } },
    ],
    neutral: [
      { sidc: 'SNGPUUO----A---', name: { en: 'Observation Post', no: 'Observasjonspost' } },
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
      { sidc: 'SFGPUCR----B---', name: { en: 'CBRN Squad', no: 'CBRN-tropp' } },
      { sidc: 'SFGPUCR----E---', name: { en: 'CBRN Company', no: 'CBRN-kompani' } },
    ],
    hostile: [
      { sidc: 'SHGPUCR----E---', name: { en: 'CBRN Company', no: 'CBRN-kompani' } },
    ],
    neutral: [
      { sidc: 'SNGPUCR----E---', name: { en: 'CBRN Company', no: 'CBRN-kompani' } },
    ],
  },
};

export const DRAW_COLORS = [
  { id: 'blue', color: '#3b82f6', label: 'Blå', labelEn: 'Blue' },
  { id: 'red', color: '#ef4444', label: 'Rød', labelEn: 'Red' },
  { id: 'green', color: '#22c55e', label: 'Grønn', labelEn: 'Green' },
  { id: 'yellow', color: '#eab308', label: 'Gul', labelEn: 'Yellow' },
  { id: 'orange', color: '#f97316', label: 'Oransje', labelEn: 'Orange' },
  { id: 'purple', color: '#a855f7', label: 'Lilla', labelEn: 'Purple' },
  { id: 'cyan', color: '#06b6d4', label: 'Cyan', labelEn: 'Cyan' },
  { id: 'pink', color: '#ec4899', label: 'Rosa', labelEn: 'Pink' },
  { id: 'white', color: '#ffffff', label: 'Hvit', labelEn: 'White' },
  { id: 'black', color: '#1e293b', label: 'Svart', labelEn: 'Black' },
];
