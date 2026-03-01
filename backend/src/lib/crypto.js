import crypto from 'crypto';
import config from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.scryptSync(config.sessionSecret || 'fallback-key', 'wasos-salt', 32);

/**
 * Encrypt text using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted string in format iv:authTag:ciphertext
 */
export function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt text encrypted with encrypt()
 * @param {string} data - Encrypted string in format iv:authTag:ciphertext
 * @returns {string} - Decrypted plain text
 */
export function decrypt(data) {
  const [ivHex, authTagHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
