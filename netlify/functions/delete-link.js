const { createHmac } = require('crypto');
const { getStore } = require('@netlify/blobs');

function verifyAdmin(cookie) {
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

  const admin = verifyAdmin(event.headers.cookie || '');
  if (!admin || admin.email !== process.env.ADMIN_EMAIL) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { linkId, store: storeName } = JSON.parse(event.body || '{}');
  if (!linkId || !storeName) return { statusCode: 400, headers, body: JSON.stringify({ error: 'linkId and store required' }) };

  const store = getStore({ name: storeName, consistency: 'strong' });
  const { blobs = [] } = await store.list();
  const match = blobs.find(b => b.key.includes(linkId));
  if (!match) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Link not found' }) };

  await store.delete(match.key);
  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};
