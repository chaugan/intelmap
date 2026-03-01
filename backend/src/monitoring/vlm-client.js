import fs from 'fs';
import path from 'path';
import os from 'os';
import { getVlmApiToken, getVlmUrl } from '../config.js';

/**
 * VlmClient - Integration with Vision Language Model API
 *
 * Handles:
 * - Sending images for inference with natural language prompts
 * - Parsing detection results
 * - Retrieving raw images
 */
class VlmClient {
  constructor() {
    // URL is fetched dynamically from config
  }

  getBaseUrl() {
    return getVlmUrl();
  }

  /**
   * Check if VLM is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!getVlmApiToken();
  }

  /**
   * Build prompt from user labels
   * @param {string[]} labels - Labels to detect
   * @returns {string} - Formatted prompt
   */
  buildPrompt(labels) {
    const labelList = labels.join(', ');
    return `For each object in this image, return ALL applicable labels from: ${labelList}

Return EXACTLY this JSON format:
{"objects": [{"bbox": [x1, y1, x2, y2], "labels": ["label1", "label2"]}]}

Rules:
- Each detected object gets ONE entry with ALL matching labels from the list
- "bbox" MUST be an array of exactly 4 integers: [left, top, right, bottom]
- "labels" is an array of strings - include EVERY applicable label per object
- Example: a tank could have labels ["tank", "stridsvogn", "militære kjøretøy"]
- If nothing is found, return: {"objects": []}
- Output ONLY valid JSON, no markdown, no explanation`;
  }

  /**
   * Run inference on an image
   * @param {string} imagePath - Path to image file
   * @param {string[]} labels - Labels to detect
   * @returns {Object} - { jobId, detections: [{ label, bbox }], inferenceTime }
   */
  async infer(imagePath, labels) {
    const token = getVlmApiToken();

    if (!token) {
      throw new Error('VLM API not configured');
    }

    if (!labels || labels.length === 0) {
      throw new Error('At least one label is required');
    }

    // Read image file
    const imageBuffer = fs.readFileSync(imagePath);
    const filename = path.basename(imagePath);

    // Build prompt
    const prompt = this.buildPrompt(labels);

    // Create form data manually (Node.js native)
    const boundary = `----FormBoundary${Date.now()}`;
    const CRLF = '\r\n';

    // Construct body as Buffer for binary data
    const parts = [];

    // File part
    parts.push(Buffer.from(`--${boundary}${CRLF}`, 'utf-8'));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}`, 'utf-8'));
    parts.push(Buffer.from(`Content-Type: image/jpeg${CRLF}${CRLF}`, 'utf-8'));
    parts.push(imageBuffer);
    parts.push(Buffer.from(CRLF, 'utf-8'));

    // Prompt part
    parts.push(Buffer.from(`--${boundary}${CRLF}`, 'utf-8'));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="prompt"${CRLF}${CRLF}`, 'utf-8'));
    parts.push(Buffer.from(prompt, 'utf-8'));
    parts.push(Buffer.from(CRLF, 'utf-8'));

    // End boundary
    parts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf-8'));

    const fullBody = Buffer.concat(parts);

    const response = await fetch(`${this.getBaseUrl()}/api/v1/categorize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`VLM API error: ${response.status} ${text}`);
    }

    const result = await response.json();

    // Parse the JSON response string (may be wrapped in markdown code fences)
    let parsed;
    try {
      let responseText = result.response;
      // Strip markdown code fences if present
      if (responseText.startsWith('```')) {
        responseText = responseText
          .replace(/^```json?\n?/, '')
          .replace(/\n?```$/, '');
      }
      // Fix common JSON errors: missing ] before "labels"
      // e.g., {"bbox": [1, 2, 3, 4, "labels": [...]} -> {"bbox": [1, 2, 3, 4], "labels": [...]}
      responseText = responseText.replace(/\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*"labels"/g, '[$1, $2, $3, $4], "labels"');
      parsed = JSON.parse(responseText);
    } catch (err) {
      throw new Error(`VLM returned invalid JSON: ${result.response}`);
    }

    // Extract detections from the response (new multi-label format)
    const objects = parsed.objects || parsed.object || [];
    const detections = [];

    for (const obj of objects) {
      if (!Array.isArray(obj.bbox) || obj.bbox.length !== 4) continue;

      // Handle new format: { bbox, labels: [] }
      if (Array.isArray(obj.labels)) {
        for (const label of obj.labels) {
          detections.push({ label, bbox: obj.bbox });
        }
      }
      // Handle old format: { name, found, bbox }
      else if (obj.found === true && obj.name) {
        detections.push({ label: obj.name, bbox: obj.bbox });
      }
    }

    return {
      jobId: result.job_id,
      detections,
      inferenceTime: result.inference_time_ms,
    };
  }

  /**
   * Get raw (un-annotated) image from a completed job
   * @param {string} jobId - Job ID from inference
   * @returns {Buffer} - Image buffer
   */
  async getRawImageBuffer(jobId) {
    const token = getVlmApiToken();

    if (!token) {
      throw new Error('VLM API not configured');
    }

    const response = await fetch(`${this.getBaseUrl()}/api/v1/jobs/${jobId}/raw`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get raw image: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Get raw image and save to temp file
   * @param {string} jobId - Job ID from inference
   * @returns {string} - Path to downloaded raw image
   */
  async getRaw(jobId) {
    const buffer = await this.getRawImageBuffer(jobId);
    const tempPath = path.join(os.tmpdir(), `vlm-${jobId}-raw.jpg`);
    fs.writeFileSync(tempPath, buffer);
    return tempPath;
  }

  /**
   * Match detected labels against monitored labels
   * @param {Array} detections - Array of { label, bbox }
   * @param {string[]} monitoredLabels - Labels user is monitoring
   * @returns {Array} - Grouped matches: [{ label, count, bbox (first occurrence) }]
   */
  matchLabels(detections, monitoredLabels) {
    if (!detections || !monitoredLabels) return [];
    const monitoredSet = new Set(monitoredLabels.map(l => l?.toLowerCase()).filter(Boolean));
    const matches = new Map();

    for (const d of detections) {
      if (!d?.label) continue;
      const label = d.label.toLowerCase();
      if (monitoredSet.has(label)) {
        if (!matches.has(label)) {
          matches.set(label, { label, count: 0, bbox: d.bbox });
        }
        matches.get(label).count++;
      }
    }

    return Array.from(matches.values());
  }
}

// Export singleton
export const vlmClient = new VlmClient();
