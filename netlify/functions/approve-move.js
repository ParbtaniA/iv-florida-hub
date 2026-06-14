const { createHmac, createSign } = require('crypto');

const SITE_ID = process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN || process.env.TOKEN;

function verifyToken(cookie) {
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

async function getDriveToken() {
  const privateKey = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const email = process.env.GOOGLE_SA_EMAIL;
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(privateKey, 'base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${sig}`
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Drive token failed');
  return data.access_token;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };
  const user = verifyToken(event.headers.cookie || '');
  if (!user || user.email !== process.env.ADMIN_EMAIL) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  try {
    const { requestId } = JSON.parse(event.body);
    const blobUrl = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/move-requests/${encodeURIComponent(requestId)}`;
    const br = await fetch(blobUrl, { headers: { Authorization: `Bearer ${BLOBS_TOKEN}` } });
    if (!br.ok) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Request not found' }) };
    const req = await br.json();
    const token = await getDriveToken();
    const metaResp = await fetch(`https://www.googleapis.com/drive/v3/files/${req.fileId}?fields=parents`, { headers: { Authorization: `Bearer ${token}` } });
    const meta = await metaResp.json();
    const currentParents = (meta.parents || []).join(',');
    const moveResp = await fetch(`https://www.googleapis.com/drive/v3/files/${req.fileId}?addParents=${req.targetFolderId}&removeParents=${currentParents}&fields=id`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}'
    });
    const moved = await moveResp.json();
    if (moved.error) throw new Error('Move failed: ' + moved.error.message);
    await fetch(`https://www.googleapis.com/drive/v3/files/${req.fileId}/permissions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: process.env.GOOGLE_SA_EMAIL })
    });
    await fetch(blobUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${BLOBS_TOKEN}` } });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
