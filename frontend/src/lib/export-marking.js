export function drawSecurityMarking(ctx, width, height, marking, corner, customText) {
  if (!marking || marking === 'none') return;

  // Reset any transform left by html2canvas (scale:2 etc.)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const label = marking === 'custom' ? (customText || 'CUSTOM').toUpperCase() : marking.toUpperCase();
  const borderColor = marking === 'internt' ? '#000000' : marking === 'tjenstlig' ? '#16a34a' : '#1d4ed8';
  const fontSize = Math.max(18, Math.round(height * 0.025));
  const margin = Math.round(height * 0.03);
  const padX = Math.round(fontSize * 0.8);
  const padY = Math.round(fontSize * 0.45);

  ctx.font = `bold ${fontSize}px sans-serif`;
  const textWidth = ctx.measureText(label).width;
  const boxW = textWidth + padX * 2;
  const boxH = fontSize + padY * 2;

  let x, y;
  if (corner === 'top-left') { x = margin; y = margin; }
  else if (corner === 'top-center') { x = (width - boxW) / 2; y = margin; }
  else if (corner === 'bottom-left') { x = margin; y = height - margin - boxH; }
  else if (corner === 'bottom-right') { x = width - margin - boxW; y = height - margin - boxH; }
  else { x = width - margin - boxW; y = margin; } // top-right default

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, boxW, boxH);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + boxW / 2, y + boxH / 2);

  ctx.restore();
}
