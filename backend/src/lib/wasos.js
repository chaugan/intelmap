/**
 * WaSOS Keycloak OAuth authentication service
 *
 * Handles form-based Keycloak login flow with PKCE:
 * 1. Generate PKCE code_verifier and code_challenge
 * 2. GET authorization URL -> redirects to login page with session params
 * 3. Parse form action URL from HTML (contains session_code, execution, tab_id)
 * 4. POST username/password to form action
 * 5. Follow redirect chain to callback with ?code=...
 * 6. Exchange code for tokens at token endpoint (with code_verifier)
 */

import crypto from 'crypto';

const AUTH_BASE = 'https://wasos.no/auth/realms/jisr/protocol/openid-connect';
const CLIENT_ID = 'apisec';
const REDIRECT_URI = 'https://wasos.no/apisec/callback';

/**
 * Generate PKCE code verifier and challenge
 * @returns {{verifier: string, challenge: string}}
 */
function generatePKCE() {
  // Generate random 32 bytes, base64url encode to get ~43 char verifier
  const verifier = crypto.randomBytes(32)
    .toString('base64url');

  // SHA256 hash the verifier, then base64url encode
  const challenge = crypto.createHash('sha256')
    .update(verifier)
    .digest('base64url');

  return { verifier, challenge };
}

/**
 * Perform Keycloak login and obtain access/refresh tokens
 * @param {string} username - WaSOS username
 * @param {string} password - WaSOS password
 * @returns {Promise<{access_token: string, refresh_token: string, expires_at: number}>}
 */
export async function wasosLogin(username, password) {
  // Step 1: Generate PKCE verifier and challenge
  const pkce = generatePKCE();

  // Step 2: Start OAuth flow - get login page
  const authUrl = `${AUTH_BASE}/auth?` + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  });

  // Fetch login page (don't follow redirects automatically for callback)
  const loginPageRes = await fetch(authUrl, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'IntelMap/1.0',
      'Accept': 'text/html',
    },
  });

  // If already redirected to callback, we have a problem - need actual login
  if (loginPageRes.status >= 300 && loginPageRes.status < 400) {
    throw new Error('Unexpected redirect during login initialization');
  }

  if (!loginPageRes.ok) {
    throw new Error(`Failed to fetch login page: ${loginPageRes.status}`);
  }

  const loginPageHtml = await loginPageRes.text();

  // Step 3: Parse form action URL from HTML
  // The form action contains the session_code, execution, tab_id etc.
  const formActionMatch = loginPageHtml.match(/action="([^"]+)"/);
  if (!formActionMatch) {
    throw new Error('Could not find login form action URL');
  }

  // Decode HTML entities in the URL
  let formAction = formActionMatch[1]
    .replace(/&amp;/g, '&')
    .replace(/&#x3d;/gi, '=');

  // Get cookies from login page response for session continuity
  const cookies = loginPageRes.headers.getSetCookie?.() || [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

  // Step 4: POST credentials to form action
  const loginRes = await fetch(formAction, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'IntelMap/1.0',
      'Cookie': cookieHeader,
    },
    body: new URLSearchParams({
      username,
      password,
      credentialId: '',
    }),
  });

  // Step 5: Follow redirects to get authorization code
  // On successful login, Keycloak redirects to callback with code
  if (loginRes.status !== 302 && loginRes.status !== 303) {
    // Check if it's an auth error (page returned instead of redirect)
    if (loginRes.status === 200) {
      const errorHtml = await loginRes.text();
      if (errorHtml.includes('Invalid username or password') ||
          errorHtml.includes('Ugyldig brukernavn eller passord')) {
        throw new Error('Invalid username or password');
      }
    }
    throw new Error(`Login failed with status ${loginRes.status}`);
  }

  const redirectUrl = loginRes.headers.get('location');
  if (!redirectUrl) {
    throw new Error('No redirect location after login');
  }

  // Parse authorization code from redirect URL
  let code;
  try {
    const callbackUrl = new URL(redirectUrl, 'https://wasos.no');
    code = callbackUrl.searchParams.get('code');
  } catch {
    throw new Error('Invalid redirect URL after login');
  }

  if (!code) {
    // Check for error in redirect
    const errorUrl = new URL(redirectUrl, 'https://wasos.no');
    const error = errorUrl.searchParams.get('error');
    if (error) {
      const errorDesc = errorUrl.searchParams.get('error_description') || error;
      throw new Error(`Auth error: ${errorDesc}`);
    }
    throw new Error('No authorization code in callback');
  }

  // Step 6: Exchange code for tokens (with PKCE verifier)
  const tokenRes = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'IntelMap/1.0',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: pkce.verifier,
    }),
  });

  if (!tokenRes.ok) {
    const errorData = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} - ${errorData}`);
  }

  const tokens = await tokenRes.json();

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in * 1000),
  };
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - The refresh token
 * @returns {Promise<{access_token: string, refresh_token: string, expires_at: number}>}
 */
export async function wasosRefresh(refreshToken) {
  const tokenRes = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'IntelMap/1.0',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!tokenRes.ok) {
    const errorData = await tokenRes.text();
    throw new Error(`Token refresh failed: ${tokenRes.status} - ${errorData}`);
  }

  const tokens = await tokenRes.json();

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in * 1000),
  };
}

/**
 * Check if session is still valid (not expired)
 * @param {object} session - Session object with expires_at
 * @returns {boolean}
 */
export function isSessionValid(session) {
  if (!session || !session.expires_at) return false;
  // Consider expired if less than 60 seconds remaining
  return session.expires_at > Date.now() + 60000;
}

/**
 * Check if session can be refreshed (has refresh token)
 * @param {object} session - Session object with refresh_token
 * @returns {boolean}
 */
export function canRefresh(session) {
  return !!(session && session.refresh_token);
}
