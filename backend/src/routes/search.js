import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q required' });

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
});

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
      // Check if type matches any term as a whole word (not as substring of longer word)
      const matchesAny = (list) => list.some(t => {
        const tLower = t.toLowerCase();
        // Split type into words and check if any matches
        const words = typeLower.split(/[\s(),]+/).filter(Boolean);
        return words.includes(tLower) || typeLower === tLower;
      });
      if (matchesAny(tier4)) return 4;
      if (matchesAny(tier3)) return 3;
      if (matchesAny(tier2)) return 2;
      if (matchesAny(tier1)) return 1;
      return 0;
    };

    // Fetch point search results (max radius 5000m per API limit)
    const pointUrl = `https://api.kartverket.no/stedsnavn/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258&radius=5000&treffPerSide=100`;
    const pointRes = await fetch(pointUrl);
    if (!pointRes.ok) throw new Error(`Kartverket ${pointRes.status}`);
    const pointData = await pointRes.json();
    const places = pointData.navn || [];

    // Sort by tier (descending), then by proximity
    const sorted = [...places].sort((a, b) => {
      const tierA = getTier(a.navneobjekttype);
      const tierB = getTier(b.navneobjekttype);
      if (tierB !== tierA) return tierB - tierA;
      return (a.meterFraPunkt || 0) - (b.meterFraPunkt || 0);
    });

    let bestPlace = sorted[0];
    let bestTier = bestPlace ? getTier(bestPlace.navneobjekttype) : -1;

    // If no high-tier result found, search for nearby settlements
    // (Tettsted/By often don't appear in point searches)
    if (bestTier < 3) {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);

      try {
        // Get the kommune (municipality) number from the kommuneinfo API
        const kommuneUrl = `https://ws.geonorge.no/kommuneinfo/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258`;
        const kommuneRes = await fetch(kommuneUrl);
        if (kommuneRes.ok) {
          const kommuneData = await kommuneRes.json();
          const kommunenummer = kommuneData.kommunenummer;
          const kommunenavn = kommuneData.kommunenavn;

          if (kommunenummer) {
            // Search for all places in this kommune, then filter for settlements
            const searchUrl = `https://api.kartverket.no/stedsnavn/v1/navn?knr=${kommunenummer}&treffPerSide=200&utkoordsys=4258`;
            const searchRes = await fetch(searchUrl);
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              const settlements = (searchData.navn || []).filter(n =>
                n.navneobjekttype === 'Tettsted' || n.navneobjekttype === 'By'
              );

              // Find closest settlement within 15km
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

      // If we only found low-tier places, append municipality for context
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
