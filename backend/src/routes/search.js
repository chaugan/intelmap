import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

/**
 * Parse a search query into components: street, number, letter, postcode, city
 */
function parseQuery(q) {
  const trimmed = q.trim();
  const result = { street: null, number: null, letter: null, postcode: null, city: null };

  // Pure 4-digit postcode
  if (/^\d{4}$/.test(trimmed)) {
    result.postcode = trimmed;
    return result;
  }

  // Split on comma for city part
  const commaParts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    result.city = commaParts.slice(1).join(' ');
  }
  const main = commaParts[0];

  // Try to extract street + number + letter
  // Pattern: "Storgata 15B" or "Storgata 15 B"
  const matchStreetFirst = main.match(/^(.+?)\s+(\d+)\s*([A-Za-z])?$/);
  // Pattern: "15 Storgata" (American style)
  const matchNumFirst = main.match(/^(\d+)\s*([A-Za-z])?\s+(.+)$/);

  if (matchStreetFirst) {
    result.street = matchStreetFirst[1];
    result.number = parseInt(matchStreetFirst[2]);
    result.letter = matchStreetFirst[3]?.toUpperCase() || null;
  } else if (matchNumFirst) {
    result.number = parseInt(matchNumFirst[1]);
    result.letter = matchNumFirst[2]?.toUpperCase() || null;
    result.street = matchNumFirst[3];
  } else {
    result.street = main;
  }

  return result;
}

/**
 * Check if query has a house number (indicating address search, not place search)
 */
function hasHouseNumber(parsed) {
  return parsed.number != null;
}

/**
 * Search places_fts for place names
 */
function searchPlaces(db, query, limit = 5) {
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='places_fts'").get();
  if (!tableCheck) return [];

  const ftsQuery = query.replace(/['"]/g, '').split(/\s+/).map(w => `"${w}"*`).join(' ');
  // Restrict FTS to name column only
  const ftsMatch = `name : ${ftsQuery}`;

  try {
    const rows = db.prepare(`
      SELECT p.name, p.type, p.municipality, p.county, p.lat, p.lon, rank
      FROM places_fts f
      JOIN places p ON p.id = f.rowid
      WHERE places_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsMatch, limit);

    return rows.map(r => ({
      name: r.name,
      type: r.type || '',
      municipality: r.municipality || '',
      county: r.county || '',
      lat: r.lat,
      lon: r.lon,
      postcode: '',
      city: '',
    }));
  } catch {
    return [];
  }
}

/**
 * Fallback: detect city/municipality matches from the addresses table
 * when places_fts is not available or returns no results.
 */
function searchCitiesFromAddresses(db, query, limit = 5) {
  const like = `${query}%`;
  try {
    // Check for city matches (exact-ish via LIKE prefix)
    const rows = db.prepare(`
      SELECT city as name, municipality, AVG(lat) as lat, AVG(lon) as lon, COUNT(*) as cnt
      FROM addresses
      WHERE city LIKE ? COLLATE NOCASE
      GROUP BY city
      ORDER BY cnt DESC
      LIMIT ?
    `).all(like, limit);

    // Also check municipality matches if no city match
    if (rows.length === 0) {
      const mRows = db.prepare(`
        SELECT municipality as name, municipality, AVG(lat) as lat, AVG(lon) as lon, COUNT(*) as cnt
        FROM addresses
        WHERE municipality LIKE ? COLLATE NOCASE
        GROUP BY municipality
        ORDER BY cnt DESC
        LIMIT ?
      `).all(like, limit);
      return mRows.map(r => ({
        name: r.name,
        type: 'By',
        municipality: r.municipality || '',
        county: '',
        lat: r.lat,
        lon: r.lon,
        postcode: '',
        city: '',
      }));
    }

    return rows.map(r => ({
      name: r.name,
      type: 'Tettsted',
      municipality: r.municipality || '',
      county: '',
      lat: r.lat,
      lon: r.lon,
      postcode: '',
      city: '',
    }));
  } catch {
    return [];
  }
}

router.get('/', (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q required' });
    if (q.length < 2) return res.json([]);

    const db = getDb();

    // Check if addresses table exists and has data
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addresses_fts'").get();
    if (!tableCheck) {
      // Fallback to Kartverket if addresses not imported yet
      return fallbackToKartverket(q, res);
    }

    const parsed = parseQuery(q);
    let addressResults = [];
    let placeResults = [];

    if (parsed.postcode && !parsed.street) {
      // Postcode search — get distinct streets in this postcode
      addressResults = db.prepare(`
        SELECT DISTINCT street, number, letter, postcode, city, municipality, lat, lon
        FROM addresses
        WHERE postcode = ?
        ORDER BY street, number
        LIMIT 15
      `).all(parsed.postcode);
    } else if (parsed.street) {
      // FTS search on street name — restrict to street column only
      const ftsQuery = parsed.street.replace(/['"]/g, '').split(/\s+/).map(w => `"${w}"*`).join(' ');
      const ftsMatch = `street : ${ftsQuery}`;

      let sql, params;

      if (parsed.number && parsed.city) {
        sql = `
          SELECT a.street, a.number, a.letter, a.postcode, a.city, a.municipality, a.lat, a.lon,
                 rank
          FROM addresses_fts f
          JOIN addresses a ON a.id = f.rowid
          WHERE addresses_fts MATCH ?
            AND a.number = ?
            AND (a.city LIKE ? OR a.municipality LIKE ?)
          ORDER BY rank
          LIMIT 15
        `;
        const cityLike = `%${parsed.city}%`;
        params = [ftsMatch, parsed.number, cityLike, cityLike];
      } else if (parsed.number && parsed.letter) {
        sql = `
          SELECT a.street, a.number, a.letter, a.postcode, a.city, a.municipality, a.lat, a.lon,
                 rank
          FROM addresses_fts f
          JOIN addresses a ON a.id = f.rowid
          WHERE addresses_fts MATCH ?
            AND a.number = ?
            AND a.letter = ?
          ORDER BY rank
          LIMIT 15
        `;
        params = [ftsMatch, parsed.number, parsed.letter];
      } else if (parsed.number) {
        sql = `
          SELECT a.street, a.number, a.letter, a.postcode, a.city, a.municipality, a.lat, a.lon,
                 rank
          FROM addresses_fts f
          JOIN addresses a ON a.id = f.rowid
          WHERE addresses_fts MATCH ?
            AND a.number = ?
          ORDER BY rank
          LIMIT 15
        `;
        params = [ftsMatch, parsed.number];
      } else if (parsed.city) {
        sql = `
          SELECT a.street, a.number, a.letter, a.postcode, a.city, a.municipality, a.lat, a.lon,
                 rank
          FROM addresses_fts f
          JOIN addresses a ON a.id = f.rowid
          WHERE addresses_fts MATCH ?
            AND (a.city LIKE ? OR a.municipality LIKE ?)
          ORDER BY rank
          LIMIT 15
        `;
        const cityLike = `%${parsed.city}%`;
        params = [ftsMatch, cityLike, cityLike];
      } else {
        // Street name only — group by unique street+city to avoid duplicates
        sql = `
          SELECT a.street, MIN(a.number) as number, a.letter, a.postcode, a.city, a.municipality, a.lat, a.lon,
                 rank
          FROM addresses_fts f
          JOIN addresses a ON a.id = f.rowid
          WHERE addresses_fts MATCH ?
          GROUP BY a.street, a.postcode
          ORDER BY rank
          LIMIT 10
        `;
        params = [ftsMatch];
      }

      addressResults = db.prepare(sql).all(...params);

      // Search places when there's no house number (pure name search)
      if (!hasHouseNumber(parsed)) {
        placeResults = searchPlaces(db, parsed.street, 5);
        // Fallback: detect city/municipality from addresses table
        if (placeResults.length === 0) {
          placeResults = searchCitiesFromAddresses(db, parsed.street, 5);
        }
        // If place results found, skip address results to avoid
        // "Trondheimsvegen" cluttering results when searching "Trondheim"
        if (placeResults.length > 0) {
          addressResults = [];
        }
      }
    } else {
      addressResults = [];
    }

    // Format address results
    const formattedAddresses = addressResults.map(r => {
      let name = r.street || '';
      if (r.number) name += ` ${r.number}`;
      if (r.letter) name += r.letter;
      return {
        name,
        type: 'Adresse',
        municipality: r.municipality || '',
        county: '',
        lat: r.lat,
        lon: r.lon,
        postcode: r.postcode || '',
        city: r.city || '',
      };
    });

    // Places first, then addresses
    res.json([...placeResults, ...formattedAddresses]);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function fallbackToKartverket(q, res) {
  try {
    const url = `https://api.kartverket.no/stedsnavn/v1/navn?sok=${encodeURIComponent(q)}&fuzzy=true&treffPerSide=10&utkoordsys=4258`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Kartverket ${response.status}`);
    const data = await response.json();

    const results = (data.navn || []).map((n) => {
      const rep = n.representasjonspunkt || {};
      return {
        name: typeof n.skrivemåte === 'string' ? n.skrivemåte : (n.skrivemåte?.[0]?.langnavn || n.skrivemåte?.[0]?.skrivemåte || 'Unknown'),
        type: n.navneobjekttype || '',
        municipality: n.kommuner?.[0]?.kommunenavn || '',
        county: n.fylker?.[0]?.fylkesnavn || '',
        lat: rep.nord || rep.lat || 0,
        lon: rep.øst || rep.lon || 0,
      };
    });

    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}

// Reverse geocode - find nearest place name for coordinates
// Prioritizes settlements and larger geographical areas over small features
router.get('/reverse', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    // Priority tiers for place types (higher tier = more preferred)
    // Tier 4: Settlements - most recognizable for weather reports
    const tier4 = ['By', 'Tettsted'];
    // Tier 3: Large geographical areas
    const tier3 = ['Dal', 'Vidde', 'Fjellområde', 'Halvøy', 'Øy', 'Fjord', 'Innsjø', 'Bre'];
    // Tier 2: Smaller populated places and notable features
    const tier2 = ['Bygd', 'Grend', 'Fjell', 'Nes', 'Vik'];
    // Tier 1: Natural features
    const tier1 = ['Elv', 'Vann', 'Strand', 'Skog', 'Myr', 'Hei', 'Mo', 'Bukt'];

    const getTier = (type) => {
      if (!type) return 0;
      const typeLower = type.toLowerCase();
      const matchesAny = (list) => list.some(t => {
        const tLower = t.toLowerCase();
        const words = typeLower.split(/[\s(),]+/).filter(Boolean);
        return words.includes(tLower) || typeLower === tLower;
      });
      if (matchesAny(tier4)) return 4;
      if (matchesAny(tier3)) return 3;
      if (matchesAny(tier2)) return 2;
      if (matchesAny(tier1)) return 1;
      return 0;
    };

    const pointUrl = `https://api.kartverket.no/stedsnavn/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258&radius=5000&treffPerSide=100`;
    const pointRes = await fetch(pointUrl);
    if (!pointRes.ok) throw new Error(`Kartverket ${pointRes.status}`);
    const pointData = await pointRes.json();
    const places = pointData.navn || [];

    const sorted = [...places].sort((a, b) => {
      const tierA = getTier(a.navneobjekttype);
      const tierB = getTier(b.navneobjekttype);
      if (tierB !== tierA) return tierB - tierA;
      return (a.meterFraPunkt || 0) - (b.meterFraPunkt || 0);
    });

    let bestPlace = sorted[0];
    let bestTier = bestPlace ? getTier(bestPlace.navneobjekttype) : -1;

    if (bestTier < 3) {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);

      try {
        const kommuneUrl = `https://ws.geonorge.no/kommuneinfo/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258`;
        const kommuneRes = await fetch(kommuneUrl);
        if (kommuneRes.ok) {
          const kommuneData = await kommuneRes.json();
          const kommunenummer = kommuneData.kommunenummer;
          const kommunenavn = kommuneData.kommunenavn;

          if (kommunenummer) {
            const searchUrl = `https://api.kartverket.no/stedsnavn/v1/navn?knr=${kommunenummer}&treffPerSide=200&utkoordsys=4258`;
            const searchRes = await fetch(searchUrl);
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              const settlements = (searchData.navn || []).filter(n =>
                n.navneobjekttype === 'Tettsted' || n.navneobjekttype === 'By'
              );

              let closestDist = Infinity;
              let closestSettlement = null;

              for (const s of settlements) {
                const rep = s.representasjonspunkt || {};
                const sLat = rep.nord || rep.lat;
                const sLon = rep.øst || rep.lon;
                if (sLat && sLon) {
                  const dLat = (sLat - latNum) * 111320;
                  const dLon = (sLon - lonNum) * 111320 * Math.cos(latNum * Math.PI / 180);
                  const dist = Math.sqrt(dLat * dLat + dLon * dLon);
                  if (dist < 15000 && dist < closestDist) {
                    closestDist = dist;
                    closestSettlement = s;
                  }
                }
              }

              if (closestSettlement) {
                const name = typeof closestSettlement.skrivemåte === 'string'
                  ? closestSettlement.skrivemåte
                  : closestSettlement.skrivemåte?.[0]?.langnavn || closestSettlement.skrivemåte?.[0]?.skrivemåte;
                bestPlace = {
                  stedsnavn: [{ skrivemåte: name }],
                  navneobjekttype: closestSettlement.navneobjekttype,
                  kommuner: closestSettlement.kommuner || [{ kommunenavn }],
                  meterFraPunkt: Math.round(closestDist),
                };
                bestTier = 4;
              }
            }
          }
        }
      } catch (e) {
        // Ignore secondary search errors
      }
    }

    if (bestPlace) {
      const nameObj = bestPlace.stedsnavn?.[0];
      const name = nameObj?.skrivemåte || null;
      const municipality = bestPlace.kommuner?.[0]?.kommunenavn || '';

      const displayName = bestTier === 0 && municipality ? `${name}, ${municipality}` : name;

      res.json({
        name: displayName,
        type: bestPlace.navneobjekttype || '',
        municipality,
      });
    } else {
      res.json({ name: null });
    }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
