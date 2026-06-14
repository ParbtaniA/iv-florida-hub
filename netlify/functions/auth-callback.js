const { createHmac } = require('crypto');

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const JWT_SECRET = process.env.JWT_SECRET;
const REDIRECT_URI = 'https://iv-florida-hub.netlify.app/.netlify/functions/auth-callback';

function makeToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 8 * 3600 * 1000 })).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return { statusCode: 302, headers: { Location: '/admin?error=access_denied' }, body: '' };
  }

  if (!code) {
    // Step 1: redirect to Google
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account'
    });
    return { statusCode: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, body: '' };
  }

  // Step 2: exchange code for token
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

    if (user.email !== ADMIN_EMAIL) {
      return { statusCode: 302, headers: { Location: '/admin?error=unauthorized' }, body: '' };
    }

    const sessionToken = makeToken(user.email);
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
