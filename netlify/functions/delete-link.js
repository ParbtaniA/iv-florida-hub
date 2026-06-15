// delete-link.js — removes a link from any Blobs store (admin only)
const { createHmac } = require('crypto');

const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
const TOKEN   = process.env.NETLIFY_BLOBS_TOKEN;

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

  const { linkId, store } = JSON.parse(event.body || '{}');
  if (!linkId || !store) return { statusCode: 400, headers, body: JSON.stringify({ error: 'linkId and store required' }) };

  // Find the blob key by listing the store and matching linkId in the key
  const listResp = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!listResp.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not list store' }) };

  const { blobs = [] } = await listResp.json();
  const match = blobs.find(b => decodeURIComponent(b.key).includes(linkId));
  if (!match) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Link not found' }) };

  const delResp = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${match.key}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` }
  });

  return { statusCode: 200, headers, body: JSON.stringify({ success: delResp.ok || delResp.status === 204 }) };
};
