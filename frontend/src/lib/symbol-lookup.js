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
 * Falls back to echelon-agnostic matching (wildcard at position 11),
 * then to the raw SIDC if not found in the symbol catalog.
 */
export function getSymbolName(sidc, lang = 'no') {
  const entry = sidcMap.get(sidc);
  if (entry) return entry.name[lang] || entry.name.en;

  // Echelon-agnostic fallback: try matching with wildcard at position 11
  if (sidc && sidc.length >= 15) {
    const base = sidc.substring(0, 11) + '*' + sidc.substring(12);
    for (const [key, val] of sidcMap) {
      const keyBase = key.substring(0, 11) + '*' + key.substring(12);
      if (keyBase === base) return val.name[lang] || val.name.en;
    }
  }

  return sidc;
}

/**
 * Get full symbol info: { name, affiliation, category } or null.
 * Falls back to echelon-agnostic matching.
 */
export function getSymbolInfo(sidc) {
  const entry = sidcMap.get(sidc);
  if (entry) return entry;

  // Echelon-agnostic fallback
  if (sidc && sidc.length >= 15) {
    const base = sidc.substring(0, 11) + '*' + sidc.substring(12);
    for (const [key, val] of sidcMap) {
      const keyBase = key.substring(0, 11) + '*' + key.substring(12);
      if (keyBase === base) return val;
    }
  }

  return null;
}
