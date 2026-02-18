import { useState } from 'react';

/**
 * Displays a MET Norway weather icon SVG.
 * @param {{ symbol: string, size?: number, className?: string }} props
 */
export default function WeatherIcon({ symbol, size = 40, className = '' }) {
  const [hidden, setHidden] = useState(false);

  if (!symbol || hidden) return null;

  return (
    <img
      src={`https://raw.githubusercontent.com/metno/weathericons/main/weather/svg/${symbol}.svg`}
      alt={symbol}
      width={size}
      height={size}
      className={className}
      onError={() => setHidden(true)}
    />
  );
}
