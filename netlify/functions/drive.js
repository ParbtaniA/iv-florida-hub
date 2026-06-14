// Minimal Drive API function - uses Node built-in crypto only
const { createSign } = require('crypto');

const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
const SA_KEY_RAW = process.env.GOOGLE_SA_KEY;

async function getAccessToken() {
  const privateKey = SA_KEY_RAW.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(privateKey, 'base64url');
  const jwt = `${header}.${payload}.${sig}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

const MIME_ICONS = {
  'application/vnd.google-apps.folder': 'folder',
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.presentation': 'slides',
  'application/pdf': 'pdf',
  'image/jpeg': 'image', 'image/png': 'image', 'video/mp4': 'video',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
};

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  const { folderId } = event.queryStringParameters || {};
  if (!folderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'folderId required' }) };
  try {
    const token = await getAccessToken();
    const url = `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+trashed%3Dfalse&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&orderBy=folder,name&pageSize=100`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    if (data.error) return { statusCode: 500, headers, body: JSON.stringify({ error: data.error.message }) };
    const files = (data.files || []).map(f => ({
      id: f.id, name: f.name,
      type: MIME_ICONS[f.mimeType] || 'file',
      mimeType: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      modified: f.modifiedTime, size: f.size, viewLink: f.webViewLink
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ files, folderId }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
