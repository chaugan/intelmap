import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const COUNTY_CODES = ['03', '11', '15', '18', '31', '32', '33', '34', '39', '40', '42', '46', '50', '54', '56'];
const PER_PAGE = 500;
const DELAY_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadPlaces() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outPath = path.join(DATA_DIR, 'places.json');

  const seen = new Set();
  const places = [];

  for (const fnr of COUNTY_CODES) {
    let page = 1;
    let hasMore = true;

    console.log(`Fetching county ${fnr}...`);

    while (hasMore) {
      const url = `https://ws.geonorge.no/stedsnavn/v1/sted?fnr=${fnr}&utkoordsys=4258&treffPerSide=${PER_PAGE}&side=${page}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`  HTTP ${res.status} for county ${fnr} page ${page}, skipping`);
        break;
      }

      const data = await res.json();
      const items = data.navn || [];

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of items) {
        const stedsnummer = item.stedsnummer;
        if (!stedsnummer || seen.has(stedsnummer)) continue;
        seen.add(stedsnummer);

        const skrivemåter = item.skrivemåter || item.stedsnavn || [];
        const nameObj = skrivemåter[0];
        const name = nameObj?.skrivemåte || nameObj?.langnavn || null;
        if (!name) continue;

        const rep = item.representasjonspunkt || {};
        const lat = rep.nord ?? rep.lat;
        const lon = rep.øst ?? rep.lon;
        if (lat == null || lon == null) continue;

        const type = item.navneobjekttype || '';
        const kommune = item.kommuner?.[0]?.kommunenavn || '';
        const fylke = item.fylker?.[0]?.fylkesnavn || '';

        places.push({ stedsnummer, name, type, municipality: kommune, county: fylke, lat, lon });
      }

      const totalPages = Math.ceil((data.metadata?.totaltAntallTreff || 0) / PER_PAGE);
      hasMore = page < totalPages;
      page++;

      if (hasMore) await sleep(DELAY_MS);
    }

    console.log(`  County ${fnr}: ${places.length} total places so far`);
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(outPath, JSON.stringify(places, null, 2), 'utf-8');
  console.log(`\nDone! Saved ${places.length} places to ${outPath}`);
}

downloadPlaces().catch((err) => {
  console.error('Download failed:', err);
  process.exit(1);
});
