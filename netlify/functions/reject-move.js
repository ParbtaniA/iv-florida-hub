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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };
  const user = verifyToken(event.headers.cookie || '');
  if (!user || !process.env.ADMIN_EMAILS.split(",").map(e=>e.trim()).includes(user.email)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  try {
    const { requestId } = JSON.parse(event.body);
    await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/move-requests/${encodeURIComponent(requestId)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${BLOBS_TOKEN}` }
    });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
