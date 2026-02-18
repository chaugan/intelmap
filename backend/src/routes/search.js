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
router.get('/reverse', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    const url = `https://api.kartverket.no/stedsnavn/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258&radius=5000&treffPerSide=1`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Kartverket ${response.status}`);
    const data = await response.json();

    const place = data.navn?.[0];
    if (place) {
      res.json({
        name: typeof place.skrivemåte === 'string' ? place.skrivemåte : (place.skrivemåte?.[0]?.langnavn || place.skrivemåte?.[0]?.skrivemåte || null),
        type: place.navneobjekttype || '',
        municipality: place.kommuner?.[0]?.kommunenavn || '',
      });
    } else {
      res.json({ name: null });
    }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
