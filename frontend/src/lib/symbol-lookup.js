import { SYMBOL_CATEGORIES } from './constants.js';

// Build a lookup map from SIDC → { name, affiliation } for fast access
const sidcMap = new Map();

for (const catKey of Object.keys(SYMBOL_CATEGORIES)) {
  const cat = SYMBOL_CATEGORIES[catKey];
  for (const affiliation of ['friendly', 'hostile', 'neutral']) {
    for (const sym of (cat[affiliation] || [])) {
      sidcMap.set(sym.sidc, { name: sym.name, affiliation, category: catKey });
    }
  }
}

/**
 * Look up the display name for a SIDC code.
 * Falls back to the raw SIDC if not found in the symbol catalog.
 */
export function getSymbolName(sidc, lang = 'no') {
  const entry = sidcMap.get(sidc);
  if (entry) return entry.name[lang] || entry.name.en;
  return sidc;
}

/**
 * Get full symbol info: { name, affiliation, category } or null.
 */
export function getSymbolInfo(sidc) {
  return sidcMap.get(sidc) || null;
}
