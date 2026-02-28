import fs from 'fs';
import path from 'path';
import os from 'os';
import { getYoloApiToken, getYoloProjectId, getYoloUrl } from '../config.js';

/**
 * YoloClient - Integration with YOLO inference API
 *
 * Handles:
 * - Sending images for inference
 * - Filtering detections by label
 * - Retrieving annotated images
 */
class YoloClient {
  constructor() {
    // URL is fetched dynamically from config
  }

  getBaseUrl() {
    return getYoloUrl() || 'https://yolo.intelmap.no';
  }

  /**
   * Check if YOLO is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!getYoloApiToken();
  }

  /**
   * Run inference on an image
   * @param {string} imagePath - Path to image file
   * @param {string[]} filterLabels - Optional labels to filter results
   * @returns {Object} - { jobId, detections: [{ label, confidence, bbox }] }
   */
  async infer(imagePath, filterLabels = null) {
    const token = getYoloApiToken();
    const projectId = getYoloProjectId();

    if (!token) {
      throw new Error('YOLO API not configured');
    }

    // Read image file
    const imageBuffer = fs.readFileSync(imagePath);
    const filename = path.basename(imagePath);

    // Create form data manually (Node.js native)
    const boundary = `----FormBoundary${Date.now()}`;
    const CRLF = '\r\n';

    let body = '';
    body += `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}`;
    body += `Content-Type: image/jpeg${CRLF}${CRLF}`;

    // Construct body as Buffer for binary data
    const parts = [];
    parts.push(Buffer.from(body, 'utf-8'));
    parts.push(imageBuffer);
    parts.push(Buffer.from(`${CRLF}--${boundary}${CRLF}`, 'utf-8'));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="project_id"${CRLF}${CRLF}${projectId}${CRLF}`, 'utf-8'));
    parts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf-8'));

    const fullBody = Buffer.concat(parts);

    const response = await fetch(`${this.getBaseUrl()}/api/v1/infer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`YOLO API error: ${response.status} ${text}`);
    }

    const result = await response.json();

    // Filter detections if labels specified
    let detections = result.detections || [];
    if (filterLabels && filterLabels.length > 0) {
      const labelSet = new Set(filterLabels.map(l => l.toLowerCase()));
      detections = detections.filter(d => labelSet.has(d.label.toLowerCase()));
    }

    return {
      jobId: result.job_id,
      detections,
      inferenceTime: result.inference_time,
    };
  }

  /**
   * Get annotated image from a completed job
   * @param {string} jobId - Job ID from inference
   * @returns {string} - Path to downloaded annotated image
   */
  async getAnnotated(jobId) {
    const token = getYoloApiToken();

    if (!token) {
      throw new Error('YOLO API not configured');
    }

    const response = await fetch(`${this.getBaseUrl()}/api/v1/jobs/${jobId}/annotated`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get annotated image: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempPath = path.join(os.tmpdir(), `yolo-${jobId}-annotated.jpg`);
    fs.writeFileSync(tempPath, buffer);

    return tempPath;
  }

  /**
   * Match detected labels against monitored labels
   * @param {Array} detections - Array of { label, confidence, bbox }
   * @param {string[]} monitoredLabels - Labels user is monitoring
   * @returns {Array} - Grouped matches: [{ label, count, maxConfidence }]
   */
  matchLabels(detections, monitoredLabels) {
    const monitoredSet = new Set(monitoredLabels.map(l => l.toLowerCase()));
    const matches = new Map();

    for (const d of detections) {
      const label = d.label.toLowerCase();
      if (monitoredSet.has(label)) {
        if (!matches.has(label)) {
          matches.set(label, { label, count: 0, maxConfidence: 0 });
        }
        const m = matches.get(label);
        m.count++;
        m.maxConfidence = Math.max(m.maxConfidence, d.confidence);
      }
    }

    return Array.from(matches.values());
  }
}

// Export singleton
export const yoloClient = new YoloClient();
