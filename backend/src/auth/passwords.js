import crypto from 'crypto';

const KEYLEN = 64;
const SCRYPT_COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

export function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  }).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}
