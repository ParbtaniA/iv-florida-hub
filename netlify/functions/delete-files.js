// One-time cleanup: delete specific file IDs using admin OAuth token
const { createHmac } = require('crypto');

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
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.ADMIN_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token failed');
  return d.access_token;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  const admin = verifyAdmin(event.headers.cookie || '');
  if (!admin || admin.email !== process.env.ADMIN_EMAIL) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { fileIds } = JSON.parse(event.body);
  if (!fileIds?.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No fileIds' }) };

  const token = await getAdminToken();
  let deleted = 0, failed = [];

  await Promise.all(fileIds.map(async id => {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    });
    if (r.status === 204 || r.status === 200) deleted++;
    else failed.push(id);
  }));

  return { statusCode: 200, headers, body: JSON.stringify({ deleted, failed, total: fileIds.length }) };
};
