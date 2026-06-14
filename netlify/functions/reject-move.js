const { getStore } = require('@netlify/blobs');
const { createHmac } = require('crypto');

function verifyToken(cookie) {
  if (!cookie) return null;
  const match = cookie.match(/iv_admin=([^;]+)/);
  if (!match) return null;
  const token = match[1];
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (Date.now() > data.exp) return null;
  return data;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const user = verifyToken(event.headers.cookie || '');
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { requestId } = JSON.parse(event.body);
    const store = getStore({ name: 'move-requests', consistency: 'strong' });
    await store.delete(requestId);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
