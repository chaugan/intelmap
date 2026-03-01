import sharp from 'sharp';

/**
 * Convert detections to bbox groups (no grouping - each detection is separate)
 * @param {Array} detections - Array of { label, bbox: [x1, y1, x2, y2] }
 * @returns {Array} - Array of { bbox, labels }
 */
function groupByBbox(detections) {
  const groups = [];

  for (const det of detections) {
    if (!det.bbox || det.bbox.length !== 4) continue;
    // Each detection gets its own entry - no grouping
    groups.push({ bbox: det.bbox, labels: [det.label] });
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
  const fontSize = 14;
  const fontWeight = 'bold';
  const fontFamily = 'Arial, Helvetica, sans-serif';
  const padding = 3;

  let svgContent = '';

  for (const group of bboxGroups) {
    const [x1, y1, x2, y2] = group.bbox;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;

    // Draw bounding box
    svgContent += `<rect x="${x1}" y="${y1}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${strokeColor}" stroke-width="2"/>`;

    // Draw label(s) directly above the box (simple, no leader lines)
    const label = group.labels.join(', ');
    const textWidth = label.length * (fontSize * 0.6);
    const textHeight = fontSize + padding * 2;

    // Position label above box, centered
    let bgX = x1 + (boxWidth - textWidth - padding * 2) / 2;
    let bgY = y1 - textHeight - 2;

    // If label would go above image, put it inside the box at top
    if (bgY < 0) {
      bgY = y1 + 2;
    }

    // Clamp horizontally to image bounds
    bgX = Math.max(2, Math.min(width - textWidth - padding * 2 - 2, bgX));

    // Background rectangle
    svgContent += `<rect x="${bgX}" y="${bgY}" width="${textWidth + padding * 2}" height="${textHeight}" fill="${bgColor}" rx="2"/>`;

    // Label text
    svgContent += `<text x="${bgX + padding}" y="${bgY + fontSize + padding - 2}" fill="${textColor}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}">${escapeXml(label)}</text>`;
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
