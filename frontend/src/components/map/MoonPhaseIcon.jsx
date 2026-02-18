/**
 * Inline SVG moon phase icon.
 * @param {{ degree: number, size?: number }} props
 * degree: 0 = new moon, 90 = first quarter, 180 = full, 270 = last quarter
 */
export default function MoonPhaseIcon({ degree = 0, size = 16 }) {
  const r = size / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;

  // Normalize to 0-360
  const d = ((degree % 360) + 360) % 360;

  // illumination fraction: 0 at new (0°), 1 at full (180°)
  const illum = (1 - Math.cos(d * Math.PI / 180)) / 2;

  // Terminator ellipse rx: how wide the lit/dark boundary is
  // At 0 or 180, the terminator is a line (rx=0). At 90/270, it's a full circle.
  const terminatorRx = Math.abs(r * Math.cos(d * Math.PI / 180));

  // Determine which side is lit
  // 0-180: right side lit (waxing), 180-360: left side lit (waning)
  const waxing = d <= 180;

  // Build the lit portion path
  // Right half arc + terminator curve for waxing
  // Left half arc + terminator curve for waning
  let litPath;
  if (illum < 0.01) {
    // New moon - nothing lit
    litPath = '';
  } else if (illum > 0.99) {
    // Full moon - everything lit
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
  } else if (waxing) {
    // Right side lit: right half arc + terminator
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${terminatorRx} ${r} 0 0 ${illum > 0.5 ? 0 : 1} ${cx} ${cy - r} Z`;
  } else {
    // Left side lit: left half arc + terminator
    litPath = `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} A ${terminatorRx} ${r} 0 0 ${illum > 0.5 ? 1 : 0} ${cx} ${cy - r} Z`;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      {/* Dark base */}
      <circle cx={cx} cy={cy} r={r} fill="#374151" stroke="#6B7280" strokeWidth={0.5} />
      {/* Lit portion */}
      {litPath && <path d={litPath} fill="#FDE68A" />}
    </svg>
  );
}
