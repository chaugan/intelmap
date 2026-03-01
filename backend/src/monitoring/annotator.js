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
  const bgColor = 'rgba(0,0,0,0.75)';
  const fontSize = 12;
  const fontWeight = 'bold';
  const fontFamily = 'Arial, Helvetica, sans-serif';
  const padding = 3;

  // Color palette for different objects
  const colors = [
    '#00ff00', // green
    '#00ffff', // cyan
    '#ff00ff', // magenta
    '#ffff00', // yellow
    '#ff8800', // orange
    '#00ff88', // mint
    '#8888ff', // light blue
    '#ff88ff', // pink
  ];

  let svgContent = '';

  for (let idx = 0; idx < bboxGroups.length; idx++) {
    const group = bboxGroups[idx];
    const color = colors[idx % colors.length];
    const [x1, y1, x2, y2] = group.bbox;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;

    // Draw bounding box
    svgContent += `<rect x="${x1}" y="${y1}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${color}" stroke-width="2"/>`;

    // Draw stacked labels above the box
    const lineHeight = fontSize + padding;
    const labels = group.labels;
    const maxLabelWidth = Math.max(...labels.map(l => l.length * (fontSize * 0.6)));
    const totalHeight = labels.length * lineHeight + padding;

    // Position labels above box, centered
    let bgX = x1 + (boxWidth - maxLabelWidth - padding * 2) / 2;
    let bgY = y1 - totalHeight - 2;

    // If labels would go above image, put them inside the box at top
    if (bgY < 0) {
      bgY = y1 + 2;
    }

    // Clamp horizontally to image bounds
    bgX = Math.max(2, Math.min(width - maxLabelWidth - padding * 2 - 2, bgX));

    // Background rectangle for all labels
    svgContent += `<rect x="${bgX}" y="${bgY}" width="${maxLabelWidth + padding * 2}" height="${totalHeight}" fill="${bgColor}" rx="2"/>`;

    // Draw each label stacked
    labels.forEach((label, i) => {
      const textY = bgY + padding + (i + 1) * lineHeight - padding;
      svgContent += `<text x="${bgX + padding}" y="${textY}" fill="${color}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}">${escapeXml(label)}</text>`;
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
