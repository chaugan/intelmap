#!/usr/bin/env node
/**
 * Test script for VLM inference and annotation quality checking
 *
 * Usage:
 *   node scripts/test-vlm-annotations.js --images "C:/path/*.jpg" --labels "tank,soldier,vehicle"
 *   node scripts/test-vlm-annotations.js -i image1.jpg -i image2.jpg -l "person,car"
 *
 * Output:
 *   Creates annotated images in ./test-output/ folder
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import from parent src directory (use file:// URLs for Windows compatibility)
const vlmClientPath = pathToFileURL(path.join(__dirname, '..', 'src', 'monitoring', 'vlm-client.js')).href;
const annotatorPath = pathToFileURL(path.join(__dirname, '..', 'src', 'monitoring', 'annotator.js')).href;

const { vlmClient } = await import(vlmClientPath);
const { annotateImage } = await import(annotatorPath);

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    images: [],
    labels: [],
    outputDir: path.join(__dirname, '..', 'test-output'),
    token: process.env.VLM_API_TOKEN || '',
    url: process.env.VLM_URL || 'https://vision.homeprem.no',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--images' || arg === '-i') {
      result.images.push(args[++i]);
    } else if (arg === '--labels' || arg === '-l') {
      result.labels = args[++i].split(',').map(l => l.trim()).filter(Boolean);
    } else if (arg === '--output' || arg === '-o') {
      result.outputDir = args[++i];
    } else if (arg === '--token' || arg === '-t') {
      result.token = args[++i];
    } else if (arg === '--url' || arg === '-u') {
      result.url = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
VLM Annotation Test Script

Usage:
  node scripts/test-vlm-annotations.js [options]

Options:
  -i, --images <path>   Image path or glob pattern (can specify multiple times)
  -l, --labels <list>   Comma-separated labels to detect
  -o, --output <dir>    Output directory (default: ./test-output)
  -t, --token <token>   VLM API token (or set VLM_API_TOKEN env var)
  -u, --url <url>       VLM API URL (default: https://vision.homeprem.no)
  -h, --help            Show this help

Examples:
  node scripts/test-vlm-annotations.js -i "C:/Downloads/*.jpg" -l "tank,soldier" -t YOUR_TOKEN
  node scripts/test-vlm-annotations.js -i photo1.jpg -i photo2.jpg -l "person,car,truck"
`);
      process.exit(0);
    }
  }

  return result;
}

async function main() {
  const config = parseArgs();

  // Validate inputs
  if (config.images.length === 0) {
    console.error('Error: No images specified. Use -i or --images');
    process.exit(1);
  }
  if (config.labels.length === 0) {
    console.error('Error: No labels specified. Use -l or --labels');
    process.exit(1);
  }
  if (!config.token) {
    console.error('Error: No API token. Use -t or set VLM_API_TOKEN env var');
    process.exit(1);
  }

  // Set environment for vlmClient
  process.env.VLM_API_TOKEN = config.token;
  process.env.VLM_URL = config.url;

  // Expand glob patterns
  let imagePaths = [];
  for (const pattern of config.images) {
    // Normalize path separators for glob
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const matches = await glob(normalizedPattern);
    if (matches.length === 0) {
      // Try as literal path
      if (fs.existsSync(pattern)) {
        imagePaths.push(pattern);
      } else {
        console.warn(`Warning: No files match pattern: ${pattern}`);
      }
    } else {
      imagePaths.push(...matches);
    }
  }

  if (imagePaths.length === 0) {
    console.error('Error: No image files found');
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(config.outputDir, { recursive: true });

  console.log(`\nVLM Annotation Test`);
  console.log(`==================`);
  console.log(`Images: ${imagePaths.length} file(s)`);
  console.log(`Labels: ${config.labels.join(', ')}`);
  console.log(`Output: ${config.outputDir}\n`);

  // Process each image
  for (const imagePath of imagePaths) {
    const filename = path.basename(imagePath);
    const baseName = path.basename(imagePath, path.extname(imagePath));

    console.log(`Processing: ${filename}`);

    try {
      // Run VLM inference
      console.log(`  → Calling VLM API...`);
      const result = await vlmClient.infer(imagePath, config.labels);

      console.log(`  → Inference time: ${result.inferenceTime}ms`);
      console.log(`  → Detections: ${result.detections.length}`);

      if (result.detections.length > 0) {
        for (const det of result.detections) {
          console.log(`     - ${det.label}: [${det.bbox.join(', ')}]`);
        }
      }

      // Get raw image and annotate
      console.log(`  → Fetching raw image...`);
      const rawBuffer = await vlmClient.getRawImageBuffer(result.jobId);

      console.log(`  → Generating annotation...`);
      const annotatedBuffer = await annotateImage(rawBuffer, result.detections);

      // Save outputs
      const rawPath = path.join(config.outputDir, `${baseName}_raw.jpg`);
      const annotatedPath = path.join(config.outputDir, `${baseName}_annotated.jpg`);
      const jsonPath = path.join(config.outputDir, `${baseName}_detections.json`);

      fs.writeFileSync(rawPath, rawBuffer);
      fs.writeFileSync(annotatedPath, annotatedBuffer);
      fs.writeFileSync(jsonPath, JSON.stringify({
        image: filename,
        labels: config.labels,
        inferenceTime: result.inferenceTime,
        detections: result.detections,
      }, null, 2));

      console.log(`  ✓ Saved: ${baseName}_annotated.jpg`);
      console.log('');

    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      console.log('');
    }
  }

  console.log(`Done! Check output in: ${config.outputDir}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
