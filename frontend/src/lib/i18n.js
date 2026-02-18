const translations = {
  no: {
    // Top bar
    'app.title': 'IntelMap',
    'layer.wind': 'Vind',
    'layer.webcams': 'Webkameraer',
    'layer.avalanche': 'Skred',

    // Base layers
    'base.topo': 'Kartverket Topo',
    'base.grayscale': 'Gråtone',
    'base.toporaster': 'Raster',
    'base.osm': 'OpenStreetMap',

    // Panels
    'panel.layers': 'Lag',
    'panel.symbols': 'Symboler',
    'panel.weather': 'Vær',
    'panel.search': 'Søk',
    'panel.chat': 'AI Chat',

    // Layer manager
    'layers.title': 'Lagbehandler',
    'layers.new': 'Nytt lag',
    'layers.name': 'Lagnavn',
    'layers.create': 'Opprett',
    'layers.noLayers': 'Ingen lag ennå',
    'layers.delete': 'Slett',
    'layers.aiTag': 'AI',

    // Symbol picker
    'symbols.title': 'NATO-symboler',
    'symbols.friendly': 'Vennlig',
    'symbols.hostile': 'Fiendtlig',
    'symbols.neutral': 'Nøytral',
    'symbols.clickMap': 'Klikk på kartet for å plassere',
    'symbols.designation': 'Betegnelse',
    'symbols.cancel': 'Avbryt',
    'symbols.category': 'Kategori',

    // Drawing
    'draw.line': 'Linje',
    'draw.polygon': 'Polygon',
    'draw.circle': 'Sirkel',
    'draw.arrow': 'Pil',
    'draw.freehand': 'Frihånd',
    'draw.text': 'Tekst',
    'draw.delete': 'Slett',
    'draw.deleteAll': 'Slett alle tegninger',
    'draw.deleteSelected': 'Slett valgte',
    'draw.selectArea': 'Dra rektangel for å velge tegninger',
    'draw.selected': 'valgt',
    'draw.confirmDeleteAll': 'Slett ALLE tegninger?',
    'draw.select': 'Velg',
    'draw.color': 'Farge',

    // Weather
    'weather.title': 'Vær',
    'weather.temp': 'Temperatur',
    'weather.wind': 'Vind',
    'weather.gusts': 'Vindkast',
    'weather.clouds': 'Skydekke',
    'weather.precip': 'Nedbør',
    'weather.humidity': 'Fuktighet',
    'weather.pressure': 'Trykk',
    'weather.sunrise': 'Soloppgang',
    'weather.sunset': 'Solnedgang',
    'weather.moonPhase': 'Månefase',
    'weather.forecast': '48t prognose',
    'weather.loading': 'Henter værdata...',
    'weather.windChill': 'Vindavkjøling',
    'weather.clickMap': 'Klikk på kartet for vær',

    // Search
    'search.title': 'Stedssøk',
    'search.placeholder': 'Søk sted...',
    'search.noResults': 'Ingen resultater',

    // Chat
    'chat.title': 'AI Militærstrateg',
    'chat.placeholder': 'Spør AI-strategen...',
    'chat.send': 'Send',
    'chat.thinking': 'Tenker...',
    'chat.noKey': 'Anthropic API-nøkkel ikke konfigurert',
    'chat.screenshot': 'Skjermbilde vedlagt',

    // Context menu
    'context.title': 'Punktinfo',
    'context.pin': 'Fest',
    'context.unpin': 'Løsne',

    // Wind
    'wind.opacity': 'Vindgjennomsiktighet',
    'wind.legend': 'Vind',

    // General
    'lang.switch': 'English',
    'general.close': 'Lukk',
    'general.cancel': 'Avbryt',
    'general.save': 'Lagre',
    'general.delete': 'Slett',
    'general.loading': 'Laster...',
  },
  en: {
    'app.title': 'IntelMap',
    'layer.wind': 'Wind',
    'layer.webcams': 'Webcams',
    'layer.avalanche': 'Avalanche',

    'base.topo': 'Kartverket Topo',
    'base.grayscale': 'Grayscale',
    'base.toporaster': 'Raster',
    'base.osm': 'OpenStreetMap',

    'panel.layers': 'Layers',
    'panel.symbols': 'Symbols',
    'panel.weather': 'Weather',
    'panel.search': 'Search',
    'panel.chat': 'AI Chat',

    'layers.title': 'Layer Manager',
    'layers.new': 'New Layer',
    'layers.name': 'Layer name',
    'layers.create': 'Create',
    'layers.noLayers': 'No layers yet',
    'layers.delete': 'Delete',
    'layers.aiTag': 'AI',

    'symbols.title': 'NATO Symbols',
    'symbols.friendly': 'Friendly',
    'symbols.hostile': 'Hostile',
    'symbols.neutral': 'Neutral',
    'symbols.clickMap': 'Click on the map to place',
    'symbols.designation': 'Designation',
    'symbols.cancel': 'Cancel',
    'symbols.category': 'Category',

    'draw.line': 'Line',
    'draw.polygon': 'Polygon',
    'draw.circle': 'Circle',
    'draw.arrow': 'Arrow',
    'draw.freehand': 'Freehand',
    'draw.text': 'Text',
    'draw.delete': 'Delete',
    'draw.deleteAll': 'Delete all drawings',
    'draw.deleteSelected': 'Delete selected',
    'draw.selectArea': 'Drag rectangle to select drawings',
    'draw.selected': 'selected',
    'draw.confirmDeleteAll': 'Delete ALL drawings?',
    'draw.select': 'Select',
    'draw.color': 'Color',

    'weather.title': 'Weather',
    'weather.temp': 'Temperature',
    'weather.wind': 'Wind',
    'weather.gusts': 'Gusts',
    'weather.clouds': 'Cloud Cover',
    'weather.precip': 'Precipitation',
    'weather.humidity': 'Humidity',
    'weather.pressure': 'Pressure',
    'weather.sunrise': 'Sunrise',
    'weather.sunset': 'Sunset',
    'weather.moonPhase': 'Moon Phase',
    'weather.forecast': '48h Forecast',
    'weather.loading': 'Loading weather data...',
    'weather.windChill': 'Wind Chill',
    'weather.clickMap': 'Click map for weather',

    'search.title': 'Place Search',
    'search.placeholder': 'Search location...',
    'search.noResults': 'No results',

    'chat.title': 'AI Military Strategist',
    'chat.placeholder': 'Ask the AI strategist...',
    'chat.send': 'Send',
    'chat.thinking': 'Thinking...',
    'chat.noKey': 'Anthropic API key not configured',
    'chat.screenshot': 'Screenshot attached',

    // Context menu
    'context.title': 'Point Info',
    'context.pin': 'Pin',
    'context.unpin': 'Unpin',

    // Wind
    'wind.opacity': 'Wind opacity',
    'wind.legend': 'Wind',

    'lang.switch': 'Norsk',
    'general.close': 'Close',
    'general.cancel': 'Cancel',
    'general.save': 'Save',
    'general.delete': 'Delete',
    'general.loading': 'Loading...',
  },
};

export function t(key, lang = 'no') {
  return translations[lang]?.[key] || translations.no[key] || key;
}

export const LANGUAGES = ['no', 'en'];
