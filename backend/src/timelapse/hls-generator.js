import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import config from '../config.js';

const DATA_DIR = path.join(config.dataDir, 'timelapse');

/**
 * Generate HLS playlist and segments from frames
 */
export class HlsGenerator {
  constructor() {
    this.activeJobs = new Map(); // cameraId -> { process, lastUpdate }
  }

  /**
   * Generate or update HLS stream for a camera
   * Uses frames from the last 7 days
   */
  async generateStream(cameraId, options = {}) {
    const {
      startTime = null,
      endTime = null,
      fps = 10, // 10 frames per second = 1 minute of footage shows 10 minutes of real time
      segmentDuration = 10, // 10 second segments
    } = options;

    const cameraDir = path.join(DATA_DIR, cameraId);
    const framesDir = path.join(cameraDir, 'frames');
    const segmentsDir = path.join(cameraDir, 'segments');

    if (!fs.existsSync(framesDir)) {
      throw new Error('No frames available for this camera');
    }

    fs.mkdirSync(segmentsDir, { recursive: true });

    // Get frame list
    let frames = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort();

    if (frames.length === 0) {
      throw new Error('No frames available for this camera');
    }

    // Filter by time range if specified
    if (startTime) {
      const startStr = new Date(startTime).toISOString().replace(/[:.]/g, '-');
      frames = frames.filter(f => f >= startStr);
    }
    if (endTime) {
      const endStr = new Date(endTime).toISOString().replace(/[:.]/g, '-');
      frames = frames.filter(f => f <= endStr);
    }

    if (frames.length === 0) {
      throw new Error('No frames in specified time range');
    }

    // Create frame list file for FFmpeg
    const listFile = path.join(cameraDir, 'framelist.txt');
    const listContent = frames.map(f => {
      const framePath = path.join(framesDir, f).replace(/\\/g, '/');
      return `file '${framePath}'\nduration ${1/fps}`;
    }).join('\n');
    fs.writeFileSync(listFile, listContent);

    // Generate HLS with FFmpeg
    const playlistPath = path.join(segmentsDir, 'playlist.m3u8');
    const segmentPattern = path.join(segmentsDir, 'segment_%04d.ts');

    return new Promise((resolve, reject) => {
      const args = [
        '-y', // Overwrite output
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-g', String(fps * segmentDuration), // Keyframe every segment
        '-sc_threshold', '0',
        '-f', 'hls',
        '-hls_time', String(segmentDuration),
        '-hls_list_size', '0', // Keep all segments in playlist
        '-hls_segment_filename', segmentPattern,
        playlistPath
      ];

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        // Clean up frame list
        try { fs.unlinkSync(listFile); } catch {}

        if (code === 0) {
          resolve({
            playlistPath,
            frameCount: frames.length,
            duration: frames.length / fps,
          });
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`FFmpeg error: ${err.message}`));
      });
    });
  }

  /**
   * Get HLS playlist for a camera
   * Regenerates if stale (older than 5 minutes)
   */
  async getPlaylist(cameraId) {
    const segmentsDir = path.join(DATA_DIR, cameraId, 'segments');
    const playlistPath = path.join(segmentsDir, 'playlist.m3u8');

    // Check if playlist exists and is fresh
    if (fs.existsSync(playlistPath)) {
      const stats = fs.statSync(playlistPath);
      const age = Date.now() - stats.mtimeMs;

      // If less than 5 minutes old, return existing
      if (age < 5 * 60 * 1000) {
        return fs.readFileSync(playlistPath, 'utf-8');
      }
    }

    // Generate new playlist
    await this.generateStream(cameraId);
    return fs.readFileSync(playlistPath, 'utf-8');
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
    const playlistPath = path.join(DATA_DIR, cameraId, 'segments', 'playlist.m3u8');
    return fs.existsSync(playlistPath);
  }

  /**
   * Delete HLS stream for a camera
   */
  deleteStream(cameraId) {
    const segmentsDir = path.join(DATA_DIR, cameraId, 'segments');
    if (fs.existsSync(segmentsDir)) {
      fs.rmSync(segmentsDir, { recursive: true, force: true });
    }
  }
}

/**
 * Generate a thumbnail from frames
 */
export async function generateThumbnail(cameraId) {
  const framesDir = path.join(DATA_DIR, cameraId, 'frames');
  const thumbnailPath = path.join(DATA_DIR, cameraId, 'thumbnail.jpg');

  // Get latest frame
  const frames = fs.readdirSync(framesDir)
    .filter(f => f.endsWith('.jpg'))
    .sort();

  if (frames.length === 0) return null;

  const latestFrame = path.join(framesDir, frames[frames.length - 1]);

  // Just copy the latest frame as thumbnail (or use FFmpeg to resize)
  fs.copyFileSync(latestFrame, thumbnailPath);
  return thumbnailPath;
}

// Export singleton
export const hlsGenerator = new HlsGenerator();
