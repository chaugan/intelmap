import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

// --- TOTP ---

export async function generateTotpSecret(username) {
  const totp = new OTPAuth.TOTP({
    issuer: 'IntelMap',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri);

  return {
    secret: totp.secret.base32,
    uri,
    qrDataUrl,
  };
}

export function verifyTotpToken(secret, token) {
  const totp = new OTPAuth.TOTP({
    issuer: 'IntelMap',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  // window=1 allows 1 step before/after (±30s)
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

// --- Backup codes ---

export function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex')); // 8 hex chars
  }
  return codes;
}

export function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code.toLowerCase().replace(/\s/g, '')).digest('hex');
}

export function verifyAndConsumeBackupCode(code, hashedCodesJson) {
  const hashed = hashBackupCode(code);
  const codes = JSON.parse(hashedCodesJson || '[]');
  const idx = codes.indexOf(hashed);
  if (idx === -1) return { valid: false, remaining: codes };
  codes.splice(idx, 1);
  return { valid: true, remaining: codes };
}
