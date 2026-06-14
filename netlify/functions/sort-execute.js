// sort-execute.js — executes a confirmed sort plan using the admin's OAuth token
// Admin must be logged in (iv_admin cookie present and valid)
const { createHmac, createSign } = require('crypto');

const ARCHIVE_ID = '1X2pXyb1Hc4MtbYrWZFlK_t36F6kBryX5';
const SA_EMAIL   = process.env.GOOGLE_SA_EMAIL;

function verifyAdminToken(cookie) {
  if (!cookie) return null;
  const match = cookie.match(/iv_admin=([^;]+)/);
  if (!match) return null;
  const [payload, sig] = match[1].split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (Date.now() > data.exp) return null;
  return data;
}

// Get a Drive token from the admin's stored OAuth via Google token exchange
// We use the SA token but with full drive scope — SA is now writer on center folders
// via the root folder inheritance (root is shared with SA as reader, center folders as writer)
async function getSAWriteToken() {
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const email = process.env.GOOGLE_SA_EMAIL;
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    iss:email, scope:'https://www.googleapis.com/auth/drive',
    aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now
  })).toString('base64url');
  const { createSign } = require('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${h}.${p}`);
  const sig = sign.sign(key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${sig}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('SA write token failed: ' + JSON.stringify(d));
  return d.access_token;
}

// Use admin OAuth refresh token to get a user-level Drive token
async function getAdminDriveToken() {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.ADMIN_REFRESH_TOKEN;
  if (!refreshToken) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token'
      })
    });
    const d = await r.json();
    return d.access_token || null;
  } catch { return null; }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  // Require admin session
  const admin = verifyAdminToken(event.headers.cookie || '');
  if (!admin || admin.email !== process.env.ADMIN_EMAIL) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin login required' }) };
  }

  let plan, ambiguousOverrides;
  try {
    const body = JSON.parse(event.body);
    plan = body.plan || [];
    ambiguousOverrides = body.ambiguousOverrides || []; // manually resolved files
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }

  const allItems = [...plan, ...ambiguousOverrides];
  if (allItems.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'Nothing to sort' }) };
  }

  // Try admin OAuth first, fall back to SA write token
  let token = await getAdminDriveToken();
  const tokenSource = token ? 'admin_oauth' : 'sa_fallback';
  if (!token) token = await getSAWriteToken();

  const results = { sorted: [], errors: [], tokenSource };

  // Process all files in parallel
  await Promise.all(allItems.map(async (item) => {
    try {
      // 1. Copy to center folder
      const copyResp = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}/copy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, parents: [item.folderId] })
      });
      const copy = await copyResp.json();
      if (copy.error) throw new Error('Copy to center: ' + copy.error.message);

      // 2. Share center copy with SA so dashboard can read it
      await fetch(`https://www.googleapis.com/drive/v3/files/${copy.id}/permissions?sendNotificationEmail=false`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: SA_EMAIL })
      });

      // 3. Copy original to _Archive
      const archResp = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}/copy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, parents: [ARCHIVE_ID] })
      });
      const arch = await archResp.json();
      if (arch.error) throw new Error('Copy to archive: ' + arch.error.message);

      // 4. Delete original from Dump
      const delResp = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (delResp.status !== 204) throw new Error('Delete from Dump failed: ' + delResp.status);

      results.sorted.push({ name: item.name, destination: `${item.category}/${item.center}` });
    } catch (err) {
      results.errors.push({ name: item.name, error: err.message });
    }
  }));

  results.dumpCleared = results.errors.length === 0 && ambiguousOverrides.length === 0;
  return { statusCode: 200, headers, body: JSON.stringify(results) };
};
