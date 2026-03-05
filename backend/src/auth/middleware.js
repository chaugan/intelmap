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
 * Like requireAuth but also requires admin or super_admin role.
 */
export function requireAdmin(req, res, next) {
  const sessionId = req.cookies?.session;
  const user = validateSession(sessionId);
  if (!user || user.locked) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = user;
  // Super-admins can optionally enter an org context via X-Org-Id header
  if (user.role === 'super_admin' && req.headers['x-org-id']) {
    req.user.orgId = req.headers['x-org-id'];
  }
  next();
}

/**
 * Requires super_admin role.
 */
export function requireSuperAdmin(req, res, next) {
  const sessionId = req.cookies?.session;
  const user = validateSession(sessionId);
  if (!user || user.locked) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super-admin access required' });
  }
  req.user = user;
  next();
}

/**
 * Ensures req.user.orgId is set. Super-admins must pass X-Org-Id header.
 * Use after requireAuth.
 */
export function requireOrgContext(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Super-admins can enter an org context via header
  if (req.user.role === 'super_admin' && req.headers['x-org-id']) {
    req.user.orgId = req.headers['x-org-id'];
  }
  if (!req.user.orgId) {
    return res.status(400).json({ error: 'Organization context required' });
  }
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
