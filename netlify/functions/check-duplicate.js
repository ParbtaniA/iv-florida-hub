// check-duplicate.js
// Checks if a filename already exists in a target Drive folder
// Called from upload modal before opening Drive
const { createSign } = require('crypto');

async function getToken() {
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const email = process.env.GOOGLE_SA_EMAIL;
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    iss:email, scope:'https://www.googleapis.com/auth/drive.readonly',
    aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${h}.${p}`);
  const sig = sign.sign(key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${sig}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token failed');
  return d.access_token;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { fileName, folderId } = JSON.parse(event.body);
    if (!fileName || !folderId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'fileName and folderId required' }) };

    const token = await getToken();
    // Search for exact filename in the target folder
    const safeName = fileName.replace(/'/g, "\\'");
    const url = `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+name%3D%27${encodeURIComponent(safeName)}%27+and+trashed%3Dfalse&fields=files(id,name,webViewLink,modifiedTime)&pageSize=10`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    const matches = data.files || [];

    if (matches.length > 0) {
      return { statusCode: 200, headers, body: JSON.stringify({
        duplicate: true,
        existing: matches.map(f => ({
          name: f.name,
          url: f.webViewLink,
          modified: f.modifiedTime
        }))
      })};
    }

    return { statusCode: 200, headers, body: JSON.stringify({ duplicate: false }) };
  } catch (err) {
    // On error, don't block the upload — just skip the check
    return { statusCode: 200, headers, body: JSON.stringify({ duplicate: false, error: err.message }) };
  }
};
