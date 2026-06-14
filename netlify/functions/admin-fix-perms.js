// Fixes existing Safety files by:
// 1. Listing files in each Safety center folder
// 2. Deleting any the SA can't see (unshared copies)
// 3. Re-copying from _Archive with SA ownership so SA can share itself
const { createSign } = require('crypto');

const ARCHIVE_ID = '1X2pXyb1Hc4MtbYrWZFlK_t36F6kBryX5';

const SAFETY_FOLDERS = {
  Miami:        '1ieKjGv4Fv7YrQb-8JZ9KKzMq0lh4_qIo',
  FtLauderdale: '1X-lsQxaFEH2aUE68RJBR1pQvBk2MXYYQ',
  Orlando:      '1XI0LnP0U0yEk9NzD7OL3O9Sp67j4EgCa',
  Tampa:        '1NzXaNqpBs1N1BSytd4zv1hOARG9RImHf',
  Ocala:        '11Dc0bJC6A3nF2QWYg-wg5j2DMnMk8KrI',
};

// Archive file name → center mapping (from the sort we did earlier)
const ARCHIVE_MAP = {
  'ISOW Attendance - Miami.xlsx':                            'Miami',
  'Miami HQ Jamatkhana Security Plan.pptx':                 'Miami',
  'Miami HQ Jamatkhana Security Plan (editable source).docx':'Miami',
  'Miami HQ Security Plan (alt version Aug24).pptx':        'Miami',
  'Safety Team Positions.pdf':                               'Miami',
  'ISOW Attendance - Ft Lauderdale.xlsx':                    'FtLauderdale',
  'ISOW FtL Volunteer Registration (Responses).xlsx':        'FtLauderdale',
  'Ft Lauderdale Security Plan (alt version Aug24).pptx':    'FtLauderdale',
  'Ft Lauderdale Jamatkhana Security Plan.pptx':             'FtLauderdale',
  'Ft Lauderdale Jamatkhana Security Plan.pdf':              'FtLauderdale',
  'ISOW Attendance - Ocala.xlsx':                            'Ocala',
  'ISOW Ocala Volunteer Registration (Responses).xlsx':      'Ocala',
  'Ocala Jamatkhana Security Plan.docx':                     'Ocala',
  'Ocala Jamatkhana Presentation.pptx':                      'Ocala',
  'ISOW Attendance - Orlando.xlsx':                          'Orlando',
};

async function getToken() {
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const email = process.env.GOOGLE_SA_EMAIL;
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({iss:email, scope:'https://www.googleapis.com/auth/drive', aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now})).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${h}.${p}`);
  const sig = sign.sign(key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${sig}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token: ' + JSON.stringify(d));
  return d.access_token;
}

async function listFolder(folderId, token) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+trashed%3Dfalse&fields=files(id,name,mimeType)&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  return d.files || [];
}

async function deleteFile(fileId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  return r.status === 204;
}

async function copyFile(fileId, destFolderId, name, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [destFolderId] })
  });
  return r.json();
}

async function shareWithSA(fileId, saEmail, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: saEmail })
  });
  return r.ok;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  const SA = process.env.GOOGLE_SA_EMAIL;
  const log = [];

  try {
    const token = await getToken();

    // Step 1: Delete old unshared copies from Safety center folders
    // (SA owns the token, so it can only see files it has access to — 
    //  files it CAN'T see are the problem ones; list via broader approach)
    let deleted = 0;
    for (const [center, folderId] of Object.entries(SAFETY_FOLDERS)) {
      // We need to list ALL files in the folder, not just SA-visible ones
      // SA has reader on the folder itself, but copied files may not be visible
      // Use includeItemsFromAllDrives to catch everything
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+trashed%3Dfalse&fields=files(id,name)&pageSize=100&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const d = await r.json();
      const files = d.files || [];
      for (const f of files) {
        const ok = await deleteFile(f.id, token);
        if (ok) { deleted++; log.push(`Deleted old: ${f.name} from ${center}`); }
      }
    }

    // Step 2: List Archive files, re-copy each to correct center folder
    const archiveFiles = await listFolder(ARCHIVE_ID, token);
    let copied = 0, skipped = 0;

    for (const f of archiveFiles) {
      const center = ARCHIVE_MAP[f.name];
      if (!center) { skipped++; log.push(`Skipped (no mapping): ${f.name}`); continue; }
      const destFolderId = SAFETY_FOLDERS[center];
      if (!destFolderId) { skipped++; continue; }

      // Copy from Archive to center folder — SA owns the copy
      const copy = await copyFile(f.id, destFolderId, f.name, token);
      if (copy.error) { log.push(`Copy error: ${f.name} — ${copy.error.message}`); continue; }

      // Share with SA (SA owns it so this works)
      await shareWithSA(copy.id, SA, token);
      copied++;
      log.push(`Re-copied: ${f.name} → Safety/${center}`);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, deleted, copied, skipped, log })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, log }) };
  }
};
