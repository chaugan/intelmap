import sharp from 'sharp';

/**
 * Group detections by similar bounding boxes
 * @param {Array} detections - Array of { label, bbox: [x1, y1, x2, y2] }
 * @param {number} tolerance - Pixel tolerance for grouping
 * @returns {Array} - Array of { bbox, labels }
 */
function groupByBbox(detections, tolerance = 5) {
  const groups = [];

  for (const det of detections) {
    if (!det.bbox || det.bbox.length !== 4) continue;

    const existing = groups.find(g =>
      Math.abs(g.bbox[0] - det.bbox[0]) < tolerance &&
      Math.abs(g.bbox[1] - det.bbox[1]) < tolerance &&
      Math.abs(g.bbox[2] - det.bbox[2]) < tolerance &&
      Math.abs(g.bbox[3] - det.bbox[3]) < tolerance
    );

    if (existing) {
      existing.labels.push(det.label);
    } else {
      groups.push({ bbox: det.bbox, labels: [det.label] });
    }
  }

  return groups;
}

/**
 * Create an SVG overlay with bounding boxes and labels
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Array} bboxGroups - Array of { bbox: [x1,y1,x2,y2], labels: string[] }
 * @returns {string} - SVG string
 */
function createSvgOverlay(width, height, bboxGroups) {
  const strokeColor = '#00ff00';
  const bgColor = 'rgba(0,0,0,0.75)';
  const textColor = '#00ff00';
  const fontSize = 18;
  const fontWeight = 'bold';
  const fontFamily = 'Arial, Helvetica, sans-serif';
  const padding = 6;
  const labelOffset = 40; // Distance from box edge to label

  let svgContent = '';

  for (const group of bboxGroups) {
    const [x1, y1, x2, y2] = group.bbox;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;

    // Draw bounding box
    svgContent += `<rect x="${x1}" y="${y1}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${strokeColor}" stroke-width="2"/>`;

    // Define anchor positions around the box (distributed)
    const positions = [
      { anchorX: x1, anchorY: y1, offsetX: -labelOffset, offsetY: -labelOffset, align: 'end' },      // top-left
      { anchorX: x2, anchorY: y1, offsetX: labelOffset, offsetY: -labelOffset, align: 'start' },     // top-right
      { anchorX: x2, anchorY: y2, offsetX: labelOffset, offsetY: labelOffset, align: 'start' },      // bottom-right
      { anchorX: x1, anchorY: y2, offsetX: -labelOffset, offsetY: labelOffset, align: 'end' },       // bottom-left
      { anchorX: centerX, anchorY: y1, offsetX: 0, offsetY: -labelOffset - 20, align: 'middle' },    // top-center
      { anchorX: centerX, anchorY: y2, offsetX: 0, offsetY: labelOffset + 20, align: 'middle' },     // bottom-center
      { anchorX: x1, anchorY: centerY, offsetX: -labelOffset - 20, offsetY: 0, align: 'end' },       // left-center
      { anchorX: x2, anchorY: centerY, offsetX: labelOffset + 20, offsetY: 0, align: 'start' },      // right-center
    ];

    // Draw labels distributed around the box
    group.labels.forEach((label, i) => {
      const pos = positions[i % positions.length];

      // Calculate label position
      let labelX = pos.anchorX + pos.offsetX;
      let labelY = pos.anchorY + pos.offsetY;

      // Estimate text width
      const textWidth = label.length * (fontSize * 0.65);
      const textHeight = fontSize + padding + 2;

      // Adjust label X based on alignment
      let bgX = labelX;
      if (pos.align === 'end') {
        bgX = labelX - textWidth - padding * 2;
        labelX = bgX + padding;
      } else if (pos.align === 'middle') {
        bgX = labelX - (textWidth + padding * 2) / 2;
        labelX = bgX + padding;
      } else {
        labelX = bgX + padding;
      }

      // Clamp to image bounds
      bgX = Math.max(2, Math.min(width - textWidth - padding * 2 - 2, bgX));
      labelX = bgX + padding;
      labelY = Math.max(fontSize + padding, Math.min(height - padding - 2, labelY));
      const bgY = labelY - fontSize - 2;

      // Draw leader line from box anchor to label
      const lineToBgX = pos.align === 'end' ? bgX + textWidth + padding * 2 :
                        pos.align === 'start' ? bgX :
                        bgX + (textWidth + padding * 2) / 2;
      const lineToBgY = bgY + textHeight / 2;

      svgContent += `<line x1="${pos.anchorX}" y1="${pos.anchorY}" x2="${lineToBgX}" y2="${lineToBgY}" stroke="${strokeColor}" stroke-width="1.5"/>`;

      // Background rectangle
      svgContent += `<rect x="${bgX}" y="${bgY}" width="${textWidth + padding * 2}" height="${textHeight}" fill="${bgColor}" rx="3"/>`;

      // Label text
      svgContent += `<text x="${labelX}" y="${labelY - 3}" fill="${textColor}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}">${escapeXml(label)}</text>`;
    });
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Annotate an image with bounding boxes and labels
 * @param {Buffer} imageBuffer - Raw image buffer
 * @param {Array} detections - Array of { label, bbox: [x1, y1, x2, y2] }
 * @returns {Promise<Buffer>} - Annotated image as JPEG buffer
 */
export async function annotateImage(imageBuffer, detections) {
  if (!detections || detections.length === 0) {
    return imageBuffer; // Return original if no detections
  }

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const { width, height } = metadata;

  // Group detections by similar bbox
  const bboxGroups = groupByBbox(detections);

  // Create SVG overlay
  const svgOverlay = createSvgOverlay(width, height, bboxGroups);

  // Composite SVG over the original image
  const annotated = await sharp(imageBuffer)
    .composite([{
      input: Buffer.from(svgOverlay),
      top: 0,
      left: 0,
    }])
    .jpeg({ quality: 90 })
    .toBuffer();

  return annotated;
}
