const { createSign } = require('crypto');

// Netlify Blobs via REST API — no package import needed
const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN || process.env.TOKEN;

async function blobSet(key, value) {
  const url = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/move-requests/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${BLOBS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error('Blob write failed: ' + await r.text());
}

async function sendEmail(req) {
  try {
    const privateKey = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
    const email = process.env.GOOGLE_SA_EMAIL;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: email, sub: process.env.ADMIN_EMAIL,
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600, iat: now
    })).toString('base64url');
    const sign = createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const sig = sign.sign(privateKey, 'base64url');
    const jwt = `${header}.${payload}.${sig}`;
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    const { access_token } = await tr.json();
    if (!access_token) return;
    const admin = process.env.ADMIN_EMAIL;
    const subject = `[IV Hub] Move request: ${req.fileName}`;
    const body = `Move request submitted:\n\nFile: ${req.fileName}\nMove to: ${req.targetCategory.toUpperCase()} / ${req.targetCenter}\nReason: ${req.reason || 'None'}\n\nApprove at: https://iv-florida-hub.netlify.app/admin`;
    const raw = Buffer.from(`To: ${admin}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}`).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw })
    });
  } catch(e) { console.error('Email failed:', e.message); }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };
  try {
    const { fileId, fileName, currentFolder, targetCategory, targetCenter, targetFolderId, reason } = JSON.parse(event.body);
    if (!fileId || !targetCategory || !targetCenter || !targetFolderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const request = { id: requestId, fileId, fileName, currentFolder, targetCategory, targetCenter, targetFolderId, reason: reason || '', createdAt: new Date().toISOString(), status: 'pending' };
    await blobSet(requestId, request);
    sendEmail(request); // fire and forget
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, requestId }) };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
