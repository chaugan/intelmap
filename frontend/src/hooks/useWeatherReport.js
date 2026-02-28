import { useState, useEffect, useCallback } from 'react';

/**
 * Fetches comprehensive 7-day weather report data for a location.
 * Aggregates: forecast, sun/moon for each day, aurora/kp, snow depth, place name.
 */
export function useWeatherReport(lat, lon, enabled = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchReport = useCallback(async () => {
    if (!lat || !lon) return;

    setLoading(true);
    setError(null);

    try {
      const latStr = parseFloat(lat).toFixed(4);
      const lonStr = parseFloat(lon).toFixed(4);

      // Generate dates for next 7 days
      const dates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
      }

      // Fetch all data in parallel
      const [forecastRes, snowRes, placeRes, auroraRes, kpRes] = await Promise.all([
        fetch(`/api/weather/forecast?lat=${latStr}&lon=${lonStr}`),
        fetch(`/api/tiles/snowdepth-at?lat=${latStr}&lon=${lonStr}`),
        fetch(`/api/search/reverse?lat=${latStr}&lon=${lonStr}`),
        fetch('/api/aurora'),
        fetch('/api/aurora/kp'),
      ]);

      // Parse responses
      const forecast = forecastRes.ok ? await forecastRes.json() : null;
      const snow = snowRes.ok ? await snowRes.json() : null;
      const place = placeRes.ok ? await placeRes.json() : null;
      const aurora = auroraRes.ok ? await auroraRes.json() : null;
      const kp = kpRes.ok ? await kpRes.json() : null;

      // Fetch sun/moon for each of 7 days
      const sunMoonData = await Promise.all(dates.map(async (date) => {
        const [sunRes, moonRes] = await Promise.all([
          fetch(`/api/weather/sun?lat=${latStr}&lon=${lonStr}&date=${date}`),
          fetch(`/api/weather/moon?lat=${latStr}&lon=${lonStr}&date=${date}`),
        ]);
        return {
          date,
          sun: sunRes.ok ? await sunRes.json() : null,
          moon: moonRes.ok ? await moonRes.json() : null,
        };
      }));

      // Process forecast timeseries into daily summaries
      const timeseries = forecast?.properties?.timeseries || [];
      const dailySummaries = processDailySummaries(timeseries, dates);

      // Merge sun/moon data into daily summaries
      sunMoonData.forEach((sm) => {
        const day = dailySummaries.find(d => d.date === sm.date);
        if (day) {
          day.sunrise = sm.sun?.properties?.sunrise?.time || null;
          day.sunset = sm.sun?.properties?.sunset?.time || null;
          day.moonphase = sm.moon?.properties?.moonphase ?? null;
        }
      });

      setData({
        location: {
          lat: parseFloat(lat),
          lon: parseFloat(lon),
          name: place?.name || null,
        },
        current: extractCurrentConditions(timeseries[0]),
        daily: dailySummaries,
        snowDepth: snow?.depth ? snow : null,
        aurora,
        kp,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Weather report fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    if (enabled && lat && lon) {
      fetchReport();
    }
  }, [enabled, lat, lon, fetchReport]);

  return { data, loading, error, refetch: fetchReport };
}

/**
 * Extract current weather conditions from first timeseries entry.
 */
function extractCurrentConditions(entry) {
  if (!entry) return null;

  const details = entry.data?.instant?.details || {};
  const next1h = entry.data?.next_1_hours;
  const next6h = entry.data?.next_6_hours;
  const symbol = next1h?.summary?.symbol_code || next6h?.summary?.symbol_code;

  return {
    time: entry.time,
    symbol,
    temperature: details.air_temperature,
    feelsLike: calcFeelsLike(details.air_temperature, details.wind_speed, details.relative_humidity),
    windSpeed: details.wind_speed,
    windGust: details.wind_speed_of_gust,
    windDirection: details.wind_from_direction,
    humidity: details.relative_humidity,
    pressure: details.air_pressure_at_sea_level,
    cloudCover: details.cloud_area_fraction,
    precipitation: next1h?.details?.precipitation_amount || 0,
    uvIndex: details.ultraviolet_index_clear_sky,
  };
}

/**
 * Process timeseries into daily summaries with high/low temps, precipitation totals, etc.
 */
function processDailySummaries(timeseries, dates) {
  const dailyMap = {};

  // Initialize each day
  dates.forEach(date => {
    dailyMap[date] = {
      date,
      temps: [],
      winds: [],
      gusts: [],
      clouds: [],
      precip: 0,
      symbols: [],
      entries: [],
    };
  });

  // Group timeseries by date
  timeseries.forEach(entry => {
    const entryDate = entry.time.slice(0, 10);
    if (!dailyMap[entryDate]) return;

    const details = entry.data?.instant?.details || {};
    const day = dailyMap[entryDate];

    if (details.air_temperature != null) day.temps.push(details.air_temperature);
    if (details.wind_speed != null) day.winds.push(details.wind_speed);
    if (details.wind_speed_of_gust != null) day.gusts.push(details.wind_speed_of_gust);
    if (details.cloud_area_fraction != null) day.clouds.push(details.cloud_area_fraction);

    // Accumulate precipitation
    const precip = entry.data?.next_1_hours?.details?.precipitation_amount
      || entry.data?.next_6_hours?.details?.precipitation_amount || 0;
    day.precip += precip;

    // Collect symbols (prefer 12:00 or midday)
    const hour = new Date(entry.time).getHours();
    const symbol = entry.data?.next_1_hours?.summary?.symbol_code
      || entry.data?.next_6_hours?.summary?.symbol_code;
    if (symbol) {
      day.symbols.push({ hour, symbol });
    }

    day.entries.push({
      time: entry.time,
      temp: details.air_temperature,
      wind: details.wind_speed,
      windDir: details.wind_from_direction,
      cloud: details.cloud_area_fraction,
      symbol,
    });
  });

  // Convert to final format
  return dates.map(date => {
    const day = dailyMap[date];

    // Pick representative symbol (prefer midday, around 12:00-15:00)
    const middaySymbol = day.symbols.find(s => s.hour >= 12 && s.hour <= 15);
    const symbol = middaySymbol?.symbol || day.symbols[0]?.symbol || null;

    // Calculate aggregates
    const tempHigh = day.temps.length ? Math.max(...day.temps) : null;
    const tempLow = day.temps.length ? Math.min(...day.temps) : null;
    const windMax = day.winds.length ? Math.max(...day.winds) : null;
    const windAvg = day.winds.length ? day.winds.reduce((a, b) => a + b, 0) / day.winds.length : null;
    const gustMax = day.gusts.length ? Math.max(...day.gusts) : null;
    const cloudAvg = day.clouds.length ? day.clouds.reduce((a, b) => a + b, 0) / day.clouds.length : null;

    return {
      date,
      symbol,
      tempHigh,
      tempLow,
      windMax,
      windAvg,
      gustMax,
      cloudAvg,
      precipitation: day.precip,
      entries: day.entries,
      sunrise: null, // Will be filled in later
      sunset: null,
      moonphase: null,
    };
  });
}

/**
 * Calculate feels-like temperature (wind chill or heat index).
 */
function calcFeelsLike(temp, windSpeed, humidity) {
  if (temp == null || windSpeed == null) return temp;

  // Wind chill (for cold temps)
  if (temp <= 10 && windSpeed >= 1.34) {
    const ws = windSpeed * 3.6; // m/s to km/h
    return 13.12 + 0.6215 * temp - 11.37 * Math.pow(ws, 0.16) + 0.3965 * temp * Math.pow(ws, 0.16);
  }

  // Heat index (for warm temps with humidity)
  if (temp >= 27 && humidity != null && humidity >= 40) {
    const c1 = -8.78469475556, c2 = 1.61139411, c3 = 2.33854883889;
    const c4 = -0.14611605, c5 = -0.012308094, c6 = -0.0164248277778;
    const c7 = 0.002211732, c8 = 0.00072546, c9 = -0.000003582;
    return c1 + c2*temp + c3*humidity + c4*temp*humidity + c5*temp*temp
      + c6*humidity*humidity + c7*temp*temp*humidity + c8*temp*humidity*humidity
      + c9*temp*temp*humidity*humidity;
  }

  return temp;
}
