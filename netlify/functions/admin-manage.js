// admin-manage.js — edit/delete Drive files and Blobs links
const { createHmac } = require('crypto');

const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
function blobTok() { return process.env.NETLIFY_BLOBS_TOKEN; }

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

async function getAdminToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: process.env.ADMIN_REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Drive token failed');
  return d.access_token;
}

// List all blobs in a store and find matching link by ID
async function findBlobByLinkId(store, linkId) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`, { headers: { Authorization: `Bearer ${blobTok()}` } });
  if (!r.ok) return null;
  const { blobs = [] } = await r.json();
  return blobs.find(b => decodeURIComponent(b.key).includes(linkId)) || null;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  const admin = verifyAdmin(event.headers.cookie || '');
  if (!admin || !process.env.ADMIN_EMAILS.split(",").map(e=>e.trim()).includes(admin.email))
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { action, type, fileId, linkId, store, newName, newUrl } = JSON.parse(event.body || '{}');

  try {
    // ── Drive file actions ──
    if (type === 'file') {
      const token = await getAdminToken();

      if (action === 'delete') {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        return { statusCode: 200, headers, body: JSON.stringify({ success: r.status === 204 || r.ok }) };
      }

      if (action === 'rename' && newName) {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });
        const d = await r.json();
        return { statusCode: 200, headers, body: JSON.stringify({ success: !!d.id, name: d.name }) };
      }
    }

    // ── Blobs link actions ──
    if (type === 'link') {
      if (action === 'delete') {
        const blob = await findBlobByLinkId(store, linkId);
        if (!blob) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Link not found' }) };
        const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${blob.key}`, { method: 'DELETE', headers: { Authorization: `Bearer ${blobTok()}` } });
        return { statusCode: 200, headers, body: JSON.stringify({ success: r.ok || r.status === 204 }) };
      }

      if (action === 'edit' && (newName || newUrl)) {
        const blob = await findBlobByLinkId(store, linkId);
        if (!blob) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Link not found' }) };
        // Get current value
        const getR = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${blob.key}`, { headers: { Authorization: `Bearer ${blobTok()}` } });
        if (!getR.ok) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Link not found' }) };
        const current = await getR.json();
        const updated = { ...current, updatedAt: new Date().toISOString() };
        if (newName) updated.name = newName;
        if (newUrl) updated.url = newUrl;
        const putR = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${blob.key}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${blobTok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(updated)
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: putR.ok }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action/type' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
