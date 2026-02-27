import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import config from '../config.js';
import { getDb } from '../db/index.js';

const DATA_DIR = path.join(config.dataDir, 'timelapse');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

// Ensure exports directory exists
fs.mkdirSync(EXPORTS_DIR, { recursive: true });

/**
 * Create a new export job
 */
export function createExportJob(userId, cameraId, startTime, endTime) {
  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO timelapse_exports (id, user_id, camera_id, start_time, end_time, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(id, userId, cameraId, startTime, endTime);

  // Start processing in background
  processExport(id).catch(err => {
    console.error(`[Timelapse] Export ${id} failed:`, err.message);
  });

  return { id, status: 'pending' };
}

/**
 * Process an export job
 */
async function processExport(exportId) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM timelapse_exports WHERE id = ?').get(exportId);

  if (!job) throw new Error('Export job not found');

  // Update status to processing
  db.prepare(`
    UPDATE timelapse_exports SET status = 'processing' WHERE id = ?
  `).run(exportId);

  try {
    const cameraDir = path.join(DATA_DIR, job.camera_id);
    const framesDir = path.join(cameraDir, 'frames');

    if (!fs.existsSync(framesDir)) {
      throw new Error('No frames available');
    }

    // Get frames in time range
    const startStr = new Date(job.start_time).toISOString().replace(/[:.]/g, '-');
    const endStr = new Date(job.end_time).toISOString().replace(/[:.]/g, '-');

    let frames = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .filter(f => f >= startStr && f <= endStr);

    if (frames.length === 0) {
      throw new Error('No frames in specified time range');
    }

    // Update progress
    db.prepare(`UPDATE timelapse_exports SET progress = 10 WHERE id = ?`).run(exportId);

    // Create frame list for FFmpeg
    const listFile = path.join(cameraDir, `export_${exportId}.txt`);
    const fps = 10; // Frames per second in output
    const listContent = frames.map(f => {
      const framePath = path.join(framesDir, f).replace(/\\/g, '/');
      return `file '${framePath}'\nduration ${1/fps}`;
    }).join('\n');
    fs.writeFileSync(listFile, listContent);

    // Output file
    const outputFile = path.join(EXPORTS_DIR, `${exportId}.mp4`);

    // Update progress
    db.prepare(`UPDATE timelapse_exports SET progress = 20 WHERE id = ?`).run(exportId);

    // Run FFmpeg
    await new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', // Enable streaming
        outputFile
      ];

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';
      let lastProgress = 20;

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        // Parse progress from FFmpeg output
        const match = data.toString().match(/frame=\s*(\d+)/);
        if (match) {
          const frame = parseInt(match[1]);
          const progress = Math.min(90, 20 + Math.floor((frame / frames.length) * 70));
          if (progress > lastProgress) {
            lastProgress = progress;
            db.prepare(`UPDATE timelapse_exports SET progress = ? WHERE id = ?`).run(progress, exportId);
          }
        }
      });

      ffmpeg.on('close', (code) => {
        try { fs.unlinkSync(listFile); } catch {}

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', reject);
    });

    // Get file size
    const stats = fs.statSync(outputFile);

    // Mark as completed
    db.prepare(`
      UPDATE timelapse_exports
      SET status = 'completed', progress = 100, file_path = ?, file_size = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(outputFile, stats.size, exportId);

    console.log(`[Timelapse] Export ${exportId} completed: ${outputFile}`);

  } catch (err) {
    db.prepare(`
      UPDATE timelapse_exports SET status = 'failed', error_message = ? WHERE id = ?
    `).run(err.message, exportId);
    throw err;
  }
}

/**
 * Get export job status
 */
export function getExportStatus(exportId) {
  const db = getDb();
  return db.prepare('SELECT * FROM timelapse_exports WHERE id = ?').get(exportId);
}

/**
 * Get user's exports
 */
export function getUserExports(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM timelapse_exports
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId);
}

/**
 * Delete an export
 */
export function deleteExport(exportId, userId) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM timelapse_exports WHERE id = ? AND user_id = ?').get(exportId, userId);

  if (!job) return false;

  // Delete file if exists
  if (job.file_path && fs.existsSync(job.file_path)) {
    try { fs.unlinkSync(job.file_path); } catch {}
  }

  db.prepare('DELETE FROM timelapse_exports WHERE id = ?').run(exportId);
  return true;
}

/**
 * Get export file path (for download)
 */
export function getExportFilePath(exportId, userId) {
  const db = getDb();
  const job = db.prepare(`
    SELECT file_path FROM timelapse_exports
    WHERE id = ? AND user_id = ? AND status = 'completed'
  `).get(exportId, userId);

  if (!job?.file_path || !fs.existsSync(job.file_path)) {
    return null;
  }

  return job.file_path;
}
