const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { fileId, fileName, currentFolder, targetCategory, targetCenter, targetFolderId, reason } = JSON.parse(event.body);
    if (!fileId || !targetCategory || !targetCenter || !targetFolderId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const store = getStore({ name: 'move-requests', consistency: 'strong' });
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const request = {
      id: requestId,
      fileId,
      fileName,
      currentFolder,
      targetCategory,
      targetCenter,
      targetFolderId,
      reason: reason || '',
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    await store.setJSON(requestId, request);

    // Send email notification via Gmail API using service account
    try {
      await sendNotificationEmail(request);
    } catch (emailErr) {
      console.error('Email failed (non-fatal):', emailErr.message);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, requestId }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function sendNotificationEmail(req) {
  // Get OAuth token for Gmail
  const { createSign } = require('crypto');
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

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const { access_token } = await tokenResp.json();
  if (!access_token) return;

  const adminEmail = process.env.ADMIN_EMAIL;
  const subject = `[IV Florida Hub] Move request: ${req.fileName}`;
  const body = [
    `A file move has been requested.`,
    ``,
    `File: ${req.fileName}`,
    `Move to: ${req.targetCategory} / ${req.targetCenter}`,
    `Reason: ${req.reason || 'None given'}`,
    ``,
    `Approve or reject at: https://iv-florida-hub.netlify.app/admin`,
  ].join('\n');

  const raw = btoa(`To: ${adminEmail}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}`)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  });
}
