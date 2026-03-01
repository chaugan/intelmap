/**
 * WaSOS Keycloak OAuth authentication service
 *
 * Uses the /apisec gateway which handles PKCE internally:
 * 1. GET /apisec/login - generates PKCE, stores verifier in session cookie
 * 2. Follow redirect to Keycloak login page
 * 3. POST username/password to Keycloak form
 * 4. Follow redirect back to /apisec/callback with code
 * 5. /apisec exchanges code for tokens (using stored PKCE verifier)
 * 6. Capture session cookies for API access
 */

const APISEC_LOGIN = 'https://wasos.no/apisec/login';

/**
 * Parse Set-Cookie headers into a cookie string
 */
function parseCookies(headers) {
  const setCookies = headers.getSetCookie?.() || [];
  return setCookies.map(c => c.split(';')[0]).join('; ');
}

/**
 * Merge cookie strings
 */
function mergeCookies(...cookieStrings) {
  const cookies = new Map();
  for (const str of cookieStrings) {
    if (!str) continue;
    for (const part of str.split('; ')) {
      const [name, ...rest] = part.split('=');
      if (name) cookies.set(name, rest.join('='));
    }
  }
  return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Perform WaSOS login through the /apisec gateway
 * @param {string} username - WaSOS username
 * @param {string} password - WaSOS password
 * @returns {Promise<{cookies: string, expires_at: number}>}
 */
export async function wasosLogin(username, password) {
  // Step 1: Call /apisec/login to initiate flow and get session cookie
  const loginInitRes = await fetch(APISEC_LOGIN, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (loginInitRes.status !== 302) {
    throw new Error(`Expected redirect from /apisec/login, got ${loginInitRes.status}`);
  }

  const apisecCookies = parseCookies(loginInitRes.headers);
  const authUrl = loginInitRes.headers.get('location');

  if (!authUrl) {
    throw new Error('No redirect location from /apisec/login');
  }

  // Step 2: Fetch Keycloak login page
  const loginPageRes = await fetch(authUrl, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Cookie': apisecCookies,
    },
  });

  if (!loginPageRes.ok && loginPageRes.status !== 302) {
    throw new Error(`Failed to fetch login page: ${loginPageRes.status}`);
  }

  const keycloakCookies = parseCookies(loginPageRes.headers);
  const allCookies = mergeCookies(apisecCookies, keycloakCookies);
  const loginPageHtml = await loginPageRes.text();

  // Step 3: Parse form action URL
  const formActionMatch = loginPageHtml.match(/action="([^"]+)"/);
  if (!formActionMatch) {
    throw new Error('Could not find login form action URL');
  }

  const formAction = formActionMatch[1]
    .replace(/&amp;/g, '&')
    .replace(/&#x3d;/gi, '=');

  // Step 4: POST credentials to Keycloak
  const loginRes = await fetch(formAction, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': allCookies,
    },
    body: new URLSearchParams({
      username,
      password,
      credentialId: '',
    }),
  });

  // Check for login error
  if (loginRes.status === 200) {
    const errorHtml = await loginRes.text();
    if (errorHtml.includes('Invalid username or password') ||
        errorHtml.includes('Ugyldig brukernavn eller passord') ||
        errorHtml.includes('invalid_grant')) {
      throw new Error('Invalid username or password');
    }
    throw new Error('Login failed - unexpected response');
  }

  if (loginRes.status !== 302 && loginRes.status !== 303) {
    throw new Error(`Login failed with status ${loginRes.status}`);
  }

  // Step 5: Follow redirect to /apisec/callback
  const callbackUrl = loginRes.headers.get('location');
  if (!callbackUrl) {
    throw new Error('No redirect location after login');
  }

  // Check for OAuth error in callback URL
  const callbackParsed = new URL(callbackUrl, 'https://wasos.no');
  if (callbackParsed.searchParams.get('error')) {
    const errorDesc = callbackParsed.searchParams.get('error_description') ||
                      callbackParsed.searchParams.get('error');
    throw new Error(`Auth error: ${errorDesc}`);
  }

  const postLoginCookies = parseCookies(loginRes.headers);
  const cookiesForCallback = mergeCookies(allCookies, postLoginCookies);

  // Step 6: Call the callback URL - /apisec handles token exchange
  const callbackRes = await fetch(callbackUrl, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Cookie': cookiesForCallback,
    },
  });

  // Get session cookies from callback response
  const sessionCookies = parseCookies(callbackRes.headers);
  const finalCookies = mergeCookies(cookiesForCallback, sessionCookies);

  // Check if we got a successful response (302 redirect to app, or 200)
  if (callbackRes.status !== 200 && callbackRes.status !== 302 && callbackRes.status !== 303) {
    const errorText = await callbackRes.text();
    throw new Error(`Callback failed: ${callbackRes.status} - ${errorText.substring(0, 200)}`);
  }

  // Session typically valid for 30 minutes to a few hours
  return {
    cookies: finalCookies,
    expires_at: Date.now() + (60 * 60 * 1000), // Assume 1 hour
  };
}

/**
 * Check if session is still valid (not expired)
 * @param {object} session - Session object with expires_at
 * @returns {boolean}
 */
export function isSessionValid(session) {
  if (!session || !session.expires_at) return false;
  // Consider expired if less than 5 minutes remaining
  return session.expires_at > Date.now() + (5 * 60 * 1000);
}

/**
 * Check if session can be refreshed (has cookies)
 * @param {object} session - Session object with cookies
 * @returns {boolean}
 */
export function canRefresh(session) {
  return !!(session && session.cookies);
}

/**
 * No token refresh available with cookie-based sessions
 * Re-login is required when session expires
 */
export async function wasosRefresh() {
  throw new Error('Session expired - re-login required');
}
