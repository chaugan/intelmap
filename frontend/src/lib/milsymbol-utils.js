import ms from 'milsymbol';

const cache = new Map();

export function generateSymbolSvg(sidc, options = {}) {
  const key = `${sidc}-${JSON.stringify(options)}`;
  if (cache.has(key)) return cache.get(key);

  const symbol = new ms.Symbol(sidc, {
    size: options.size || 35,
    uniqueDesignation: options.designation || '',
    higherFormation: options.higherFormation || '',
    additionalInformation: options.additionalInfo || '',
    ...options,
  });

  const result = {
    svg: symbol.asSVG(),
    width: symbol.getSize().width,
    height: symbol.getSize().height,
    anchor: symbol.getAnchor(),
  };

  cache.set(key, result);
  return result;
}

export function getAffiliation(sidc) {
  if (!sidc || sidc.length < 2) return 'unknown';
  const code = sidc[1];
  switch (code) {
    case 'F': return 'friendly';
    case 'H': return 'hostile';
    case 'N': return 'neutral';
    case 'U': return 'unknown';
    default: return 'unknown';
  }
}

export function getEchelonCode(sidc) {
  return sidc?.length >= 12 ? sidc[11] : '-';
}

export function setEchelonCode(sidc, code) {
  if (!sidc || sidc.length < 15) return sidc;
  return sidc.substring(0, 11) + code + sidc.substring(12);
}
