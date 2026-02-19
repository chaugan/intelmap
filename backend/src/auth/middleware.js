import { validateSession } from './sessions.js';

/**
 * Reads the session cookie and attaches req.user if valid.
 * Rejects with 401 if no valid session.
 */
export function requireAuth(req, res, next) {
  const sessionId = req.cookies?.session;
  const user = validateSession(sessionId);
  if (!user || user.locked) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = user;
  next();
}

/**
 * Like requireAuth but also requires admin role.
 */
export function requireAdmin(req, res, next) {
  const sessionId = req.cookies?.session;
  const user = validateSession(sessionId);
  if (!user || user.locked) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = user;
  next();
}

/**
 * Attaches req.user if a valid session exists, otherwise continues without.
 */
export function optionalAuth(req, res, next) {
  const sessionId = req.cookies?.session;
  const user = validateSession(sessionId);
  req.user = user || null;
  next();
}
