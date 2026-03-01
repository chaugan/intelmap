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
  const bgColor = 'rgba(0,0,0,0.7)';
  const textColor = '#00ff00';
  const fontSize = 14;
  const padding = 4;

  let svgContent = '';

  for (const group of bboxGroups) {
    const [x1, y1, x2, y2] = group.bbox;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;

    // Draw bounding box
    svgContent += `<rect x="${x1}" y="${y1}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${strokeColor}" stroke-width="2"/>`;

    // Draw labels above the box
    group.labels.forEach((label, i) => {
      const labelY = Math.max(fontSize + padding, y1 - 5 - (group.labels.length - 1 - i) * (fontSize + padding + 2));
      const labelX = x1;

      // Estimate text width (rough approximation)
      const textWidth = label.length * (fontSize * 0.6);

      // Background rectangle
      svgContent += `<rect x="${labelX}" y="${labelY - fontSize}" width="${textWidth + padding * 2}" height="${fontSize + padding}" fill="${bgColor}" rx="2"/>`;

      // Label text
      svgContent += `<text x="${labelX + padding}" y="${labelY - 2}" fill="${textColor}" font-family="sans-serif" font-size="${fontSize}">${escapeXml(label)}</text>`;

      // Leader line from label to box
      svgContent += `<line x1="${labelX + textWidth / 2 + padding}" y1="${labelY}" x2="${x1 + boxWidth / 2}" y2="${y1}" stroke="${strokeColor}" stroke-width="1"/>`;
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
