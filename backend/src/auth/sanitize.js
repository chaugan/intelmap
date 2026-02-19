/**
 * Strip HTML tags and trim whitespace.
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

/**
 * Sanitize username: alphanumeric, underscore, hyphen, 2-32 chars.
 */
export function sanitizeUsername(str) {
  const clean = sanitizeString(str).toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(clean)) {
    return null;
  }
  return clean;
}

/**
 * Sanitize project name: strip HTML, 1-100 chars.
 */
export function sanitizeProjectName(str) {
  const clean = sanitizeString(str);
  if (clean.length < 1 || clean.length > 100) return null;
  return clean;
}

/**
 * Validate password: 6-128 chars.
 */
export function validatePassword(str) {
  if (typeof str !== 'string') return false;
  return str.length >= 6 && str.length <= 128;
}
