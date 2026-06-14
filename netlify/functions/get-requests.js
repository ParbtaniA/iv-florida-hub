const { createHmac } = require('crypto');

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

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  const user = verifyToken(event.headers.cookie || '');
  if (!user || user.email !== process.env.ADMIN_EMAIL) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  try {
    const listUrl = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/move-requests`;
    const lr = await fetch(listUrl, { headers: { Authorization: `Bearer ${BLOBS_TOKEN}` } });
    const list = await lr.json();
    const keys = (list.blobs || []).map(b => b.key);
    const requests = await Promise.all(keys.map(async key => {
      const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/move-requests/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${BLOBS_TOKEN}` } });
      return r.ok ? r.json() : null;
    }));
    const pending = requests.filter(r => r && r.status === 'pending').sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { statusCode: 200, headers, body: JSON.stringify({ requests: pending }) };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
