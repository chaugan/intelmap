import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import config from '../config.js';
import { getDb } from '../db/index.js';
import { frameIndexer } from './frame-indexer.js';

const DATA_DIR = path.join(config.dataDir, 'timelapse');
const FPS = 10; // 10 frames per second playback

/**
 * HLS Generator with incremental segment generation
 *
 * Instead of re-encoding all frames on every request, this generates
 * segments by hour. Only the current (incomplete) hour is regenerated.
 * Past hours are already encoded and cached.
 */
export class HlsGenerator {
  constructor() {
    this.activeJobs = new Map(); // cameraId -> Promise (prevent concurrent generation)
  }

  /**
   * Get hour key from timestamp (e.g., "2026-02-28T14")
   */
  getHourKey(timestamp) {
    return timestamp.slice(0, 13);
  }

  /**
   * Get segment name for an hour (e.g., "seg_2026-02-28T14.ts")
   */
  getSegmentName(hourKey) {
    return `seg_${hourKey}.ts`;
  }

  /**
   * Check if a segment exists in the database
   */
  getSegmentInfo(cameraId, segmentName) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM timelapse_segments WHERE camera_id = ? AND segment_name = ?
    `).get(cameraId, segmentName);
  }

  /**
   * Get all segments for a camera from the database
   */
  getAllSegments(cameraId) {
    const db = getDb();
    return db.prepare(`
      SELECT segment_name, start_timestamp, end_timestamp, frame_count, duration_seconds
      FROM timelapse_segments
      WHERE camera_id = ?
      ORDER BY start_timestamp ASC
    `).all(cameraId);
  }

  /**
   * Generate a single hour segment
   * Returns null if no frames in that hour
   */
  async generateHourSegment(cameraId, hourKey) {
    const frames = frameIndexer.getFramesForHour(cameraId, hourKey + ':00:00.000Z');
    if (frames.length === 0) return null;

    const cameraDir = path.join(DATA_DIR, cameraId);
    const framesDir = path.join(cameraDir, 'frames');
    const segmentsDir = path.join(cameraDir, 'segments');
    fs.mkdirSync(segmentsDir, { recursive: true });

    const segmentName = this.getSegmentName(hourKey);
    const segmentPath = path.join(segmentsDir, segmentName);
    const listFile = path.join(cameraDir, `framelist_${hourKey.replace(/[T:]/g, '-')}.txt`);

    // Create frame list file for FFmpeg
    const listContent = frames.map(f => {
      const framePath = path.join(framesDir, f.filename).replace(/\\/g, '/');
      return `file '${framePath}'\nduration ${1/FPS}`;
    }).join('\n');
    fs.writeFileSync(listFile, listContent);

    // Calculate duration
    const duration = frames.length / FPS;
    const startTimestamp = frames[0].timestamp;
    const endTimestamp = frames[frames.length - 1].timestamp;

    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-g', String(FPS * 2), // Keyframe every 2 seconds
        '-sc_threshold', '0',
        '-f', 'mpegts',
        segmentPath
      ];

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        try { fs.unlinkSync(listFile); } catch {}

        if (code === 0) {
          // Update database
          const db = getDb();
          db.prepare(`
            INSERT OR REPLACE INTO timelapse_segments
            (camera_id, segment_name, start_timestamp, end_timestamp, frame_count, duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(cameraId, segmentName, startTimestamp, endTimestamp, frames.length, duration);

          resolve({
            segmentName,
            startTimestamp,
            endTimestamp,
            frameCount: frames.length,
            duration,
          });
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      ffmpeg.on('error', (err) => {
        try { fs.unlinkSync(listFile); } catch {}
        reject(new Error(`FFmpeg error: ${err.message}`));
      });
    });
  }

  /**
   * Generate or update HLS stream for a camera (incremental)
   * Only regenerates missing or stale (current hour) segments
   */
  async generateStream(cameraId) {
    // Prevent concurrent generation for same camera
    if (this.activeJobs.has(cameraId)) {
      return this.activeJobs.get(cameraId);
    }

    const job = this._doGenerateStream(cameraId);
    this.activeJobs.set(cameraId, job);

    try {
      return await job;
    } finally {
      this.activeJobs.delete(cameraId);
    }
  }

  async _doGenerateStream(cameraId) {
    const hours = frameIndexer.getHoursWithFrames(cameraId);
    if (hours.length === 0) {
      throw new Error('No frames available for this camera');
    }

    const segmentsDir = path.join(DATA_DIR, cameraId, 'segments');
    fs.mkdirSync(segmentsDir, { recursive: true });

    const now = new Date();
    const currentHourKey = this.getHourKey(now.toISOString());
    let generatedCount = 0;

    // Process each hour that has frames
    for (const hour of hours) {
      const hourKey = this.getHourKey(hour);
      const segmentName = this.getSegmentName(hourKey);
      const segmentPath = path.join(segmentsDir, segmentName);
      const existingSegment = this.getSegmentInfo(cameraId, segmentName);

      // Skip if segment exists and is not the current hour
      // Current hour may have new frames, so always regenerate it
      if (existingSegment && hourKey !== currentHourKey && fs.existsSync(segmentPath)) {
        continue;
      }

      // Get current frame count for this hour
      const frames = frameIndexer.getFramesForHour(cameraId, hour);

      // For current hour, only regenerate if frame count changed
      if (existingSegment && hourKey === currentHourKey && existingSegment.frame_count === frames.length) {
        continue;
      }

      try {
        await this.generateHourSegment(cameraId, hourKey);
        generatedCount++;
      } catch (err) {
        console.error(`[HLS] Error generating segment for ${cameraId}/${hourKey}:`, err.message);
      }
    }

    if (generatedCount > 0) {
      console.log(`[HLS] Generated ${generatedCount} segment(s) for camera ${cameraId}`);
    }

    return {
      hours: hours.length,
      generated: generatedCount,
    };
  }

  /**
   * Generate M3U8 playlist from segment metadata (database query)
   */
  generatePlaylistContent(cameraId) {
    const segments = this.getAllSegments(cameraId);
    if (segments.length === 0) {
      throw new Error('No segments available');
    }

    // Find max segment duration for EXT-X-TARGETDURATION
    const maxDuration = Math.ceil(Math.max(...segments.map(s => s.duration_seconds)));

    // Calculate total duration
    const totalDuration = segments.reduce((sum, s) => sum + s.duration_seconds, 0);

    let playlist = '#EXTM3U\n';
    playlist += '#EXT-X-VERSION:3\n';
    playlist += `#EXT-X-TARGETDURATION:${maxDuration}\n`;
    playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';
    playlist += '#EXT-X-PLAYLIST-TYPE:EVENT\n';

    // Add segments with discontinuity markers for gaps
    let lastEndTime = null;
    for (const segment of segments) {
      // Add discontinuity marker if there's a gap
      if (lastEndTime !== null) {
        const gap = new Date(segment.start_timestamp) - new Date(lastEndTime);
        // If gap is more than 2 minutes (expected 1 frame/min), mark discontinuity
        if (gap > 2 * 60 * 1000) {
          playlist += '#EXT-X-DISCONTINUITY\n';
        }
      }

      playlist += `#EXTINF:${segment.duration_seconds.toFixed(3)},\n`;
      playlist += `${segment.segment_name}\n`;
      lastEndTime = segment.end_timestamp;
    }

    // Don't add ENDLIST - this is a live/growing playlist
    // playlist += '#EXT-X-ENDLIST\n';

    return playlist;
  }

  /**
   * Get HLS playlist for a camera
   * Generates missing segments incrementally
   */
  async getPlaylist(cameraId) {
    const segmentsDir = path.join(DATA_DIR, cameraId, 'segments');

    // Check if we have any segments
    const existingSegments = this.getAllSegments(cameraId);
    const frameCount = frameIndexer.getFrameCount(cameraId);

    if (frameCount === 0) {
      throw new Error('No frames available for this camera');
    }

    // Generate/update segments if needed
    // Only do full generation if we have no segments at all
    if (existingSegments.length === 0) {
      await this.generateStream(cameraId);
    } else {
      // Quick check for current hour updates
      const now = new Date();
      const currentHourKey = this.getHourKey(now.toISOString());
      const currentSegmentName = this.getSegmentName(currentHourKey);
      const currentSegment = this.getSegmentInfo(cameraId, currentSegmentName);

      const currentFrames = frameIndexer.getFramesForHour(cameraId, currentHourKey + ':00:00.000Z');

      // Regenerate current hour if frame count changed
      if (currentFrames.length > 0 && (!currentSegment || currentSegment.frame_count !== currentFrames.length)) {
        await this.generateHourSegment(cameraId, currentHourKey);
      }
    }

    return this.generatePlaylistContent(cameraId);
  }

  /**
   * Get path to a specific segment file
   */
  getSegmentPath(cameraId, segmentName) {
    const segmentPath = path.join(DATA_DIR, cameraId, 'segments', segmentName);
    return fs.existsSync(segmentPath) ? segmentPath : null;
  }

  /**
   * Check if HLS stream exists for a camera
   */
  hasStream(cameraId) {
    return this.getAllSegments(cameraId).length > 0;
  }

  /**
   * Delete HLS stream for a camera
   */
  deleteStream(cameraId) {
    const db = getDb();

    // Delete segment records
    db.prepare('DELETE FROM timelapse_segments WHERE camera_id = ?').run(cameraId);

    // Delete segment files
    const segmentsDir = path.join(DATA_DIR, cameraId, 'segments');
    if (fs.existsSync(segmentsDir)) {
      fs.rmSync(segmentsDir, { recursive: true, force: true });
    }
  }

  /**
   * Delete segments older than a cutoff (called by purge service)
   */
  deleteOldSegments(cameraId, cutoffTimestamp) {
    const db = getDb();

    // Get segments to delete
    const oldSegments = db.prepare(`
      SELECT segment_name FROM timelapse_segments
      WHERE camera_id = ? AND end_timestamp < ?
    `).all(cameraId, cutoffTimestamp);

    // Delete segment files
    const segmentsDir = path.join(DATA_DIR, cameraId, 'segments');
    for (const { segment_name } of oldSegments) {
      const segmentPath = path.join(segmentsDir, segment_name);
      try {
        if (fs.existsSync(segmentPath)) {
          fs.unlinkSync(segmentPath);
        }
      } catch {}
    }

    // Delete from database
    const result = db.prepare(`
      DELETE FROM timelapse_segments
      WHERE camera_id = ? AND end_timestamp < ?
    `).run(cameraId, cutoffTimestamp);

    return result.changes;
  }
}

/**
 * Generate a thumbnail from the latest frame
 */
export async function generateThumbnail(cameraId) {
  const framesDir = path.join(DATA_DIR, cameraId, 'frames');
  const thumbnailPath = path.join(DATA_DIR, cameraId, 'thumbnail.jpg');

  // Get latest frame from index
  const latestFrame = frameIndexer.getLatestFrame(cameraId);
  if (!latestFrame) return null;

  const framePath = path.join(framesDir, latestFrame.filename);
  if (!fs.existsSync(framePath)) return null;

  // Just copy the latest frame as thumbnail
  fs.copyFileSync(framePath, thumbnailPath);
  return thumbnailPath;
}

// Export singleton
export const hlsGenerator = new HlsGenerator();
