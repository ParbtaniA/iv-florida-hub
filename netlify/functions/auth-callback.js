const { createHmac } = require('crypto');

const CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const ADMIN_EMAILS  = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
const JWT_SECRET    = process.env.JWT_SECRET;
const REDIRECT_URI  = 'https://iv-florida-hub.netlify.app/.netlify/functions/auth-callback';
const NETLIFY_TOKEN = process.env.NETLIFY_BLOBS_TOKEN; // reuse for API calls
const NETLIFY_SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
const NETLIFY_ACCOUNT = 'ayaz-parbtani';

function makeSessionToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 8 * 3600 * 1000 })).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function storeRefreshToken(refreshToken) {
  try {
    // Store as Netlify env var so sort-execute can read it
    const existing = await fetch(
      `https://api.netlify.com/api/v1/accounts/${NETLIFY_ACCOUNT}/env/ADMIN_REFRESH_TOKEN?site_id=${NETLIFY_SITE_ID}`,
      { headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` } }
    );
    const method = existing.ok ? 'PUT' : 'POST';
    const url = method === 'PUT'
      ? `https://api.netlify.com/api/v1/accounts/${NETLIFY_ACCOUNT}/env/ADMIN_REFRESH_TOKEN?site_id=${NETLIFY_SITE_ID}`
      : `https://api.netlify.com/api/v1/accounts/${NETLIFY_ACCOUNT}/env?site_id=${NETLIFY_SITE_ID}`;
    const body = method === 'PUT'
      ? { values: [{ value: refreshToken, context: 'all' }] }
      : [{ key: 'ADMIN_REFRESH_TOKEN', values: [{ value: refreshToken, context: 'all' }] }];
    await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('Refresh token stored as env var');
  } catch(e) { console.error('Failed to store refresh token:', e.message); }
}

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) return { statusCode: 302, headers: { Location: '/admin?error=access_denied' }, body: '' };

  if (!code) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile https://www.googleapis.com/auth/drive',
      access_type: 'offline', prompt: 'consent'
    });
    return { statusCode: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, body: '' };
  }

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
    });
    const tokens = await tokenResp.json();
    if (!tokens.access_token) throw new Error('No access token');

    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const user = await userResp.json();
    if (!ADMIN_EMAILS.split(",").map(e=>e.trim()).includes(user.email)) {
      return { statusCode: 302, headers: { Location: '/admin?error=unauthorized' }, body: '' };
    }

    if (tokens.refresh_token) await storeRefreshToken(tokens.refresh_token);

    const sessionToken = makeSessionToken(user.email);
    return {
      statusCode: 302,
      headers: {
        Location: '/admin?authed=1',
        'Set-Cookie': `iv_admin=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`
      },
      body: ''
    };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `/admin?error=${encodeURIComponent(err.message)}` }, body: '' };
  }
};

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) return { statusCode: 302, headers: { Location: '/admin?error=access_denied' }, body: '' };

  if (!code) {
    // Step 1: redirect to Google — request Drive scope + offline access for refresh token
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile https://www.googleapis.com/auth/drive',
      access_type: 'offline',
      prompt: 'consent'  // force consent to always get refresh_token
    });
    return { statusCode: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, body: '' };
  }

  // Step 2: exchange code for tokens
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
    });
    const tokens = await tokenResp.json();
    if (!tokens.access_token) throw new Error('No access token');

    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const user = await userResp.json();

    if (!ADMIN_EMAILS.split(",").map(e=>e.trim()).includes(user.email)) {
      return { statusCode: 302, headers: { Location: '/admin?error=unauthorized' }, body: '' };
    }

    // Store refresh token in Netlify Blobs for sort-execute to use
    if (tokens.refresh_token) {
      await storeRefreshToken(tokens.refresh_token);
    }

    const sessionToken = makeSessionToken(user.email);
    return {
      statusCode: 302,
      headers: {
        Location: '/admin?authed=1',
        'Set-Cookie': `iv_admin=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`
      },
      body: ''
    };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `/admin?error=${encodeURIComponent(err.message)}` }, body: '' };
  }
};

