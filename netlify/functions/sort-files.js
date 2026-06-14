// sort-files.js
// Full pipeline: Dump → classify → copy to center folder → share SA → copy to Archive → delete from Dump
const { createSign } = require('crypto');

const FOLDER_IDS = {
  dump:    '1T3ADK73rj5CizyVIZ6popjiYjgFUZAqY',
  archive: '1X2pXyb1Hc4MtbYrWZFlK_t36F6kBryX5',
  eop: {
    Miami:'1jVrTx0C9iEmNrNKBR9jBRIfRhlh1DyAD', FtLauderdale:'1gpcSGPhQYSw2IqJJuJxIM6L5i7OaTJ45',
    Orlando:'1MG8GQlyr1GtW0qY2naY7TRruGMGsU2cW', Tampa:'1D_7igH1-S-p0bATOhG0b3ii51tZg2HRR',
    Ocala:'1vfoo5356GfC68lDdeiVffT9NNaKJ4Rry'
  },
  safety: {
    Miami:'1ieKjGv4Fv7YrQb-8JZ9KKzMq0lh4_qIo', FtLauderdale:'1X-lsQxaFEH2aUE68RJBR1pQvBk2MXYYQ',
    Orlando:'1XI0LnP0U0yEk9NzD7OL3O9Sp67j4EgCa', Tampa:'1NzXaNqpBs1N1BSytd4zv1hOARG9RImHf',
    Ocala:'11Dc0bJC6A3nF2QWYg-wg5j2DMnMk8KrI'
  },
  rec: {
    Miami:'10YqSvPui8lxfE31E4TpViKOqvliwmJ8G', FtLauderdale:'1c89iBn9Vse3h3HxgT9nuD6i3MonNfJ3v',
    Orlando:'1Z0DYQkYsPXUYOS--o-BAiAcFN2qgT2cA', Tampa:'1h6ra4O_LpF5bWgI6Xbo7M0S9MVk97yvB',
    Ocala:'1ASR89ZA-mEfm1ayYRtqWV4Z1SeQTYyAh'
  },
  camps: {
    Miami:'17xUbiAyEXkH00P7Lf1O9bU4Fjsk3deGF', FtLauderdale:'1qKYp_IeAarga1SiZou1Rg16PofdEi4Cf',
    Orlando:'13epUEqPvVp0bmi98rX3znJMhLtAM8dVM', Tampa:'1fKo-XKZGpcIUbSI2XkOj5CIlPKxCEKkY',
    Ocala:'12QeCkZtXbBzdSOTjBWoeyerVSF9tWDa8'
  }
};

// ── Classification rules ─────────────────────────────────────────────────────
// Returns { category, center } or null if ambiguous
function classify(name) {
  const n = name.toLowerCase();

  // Center detection
  const centerMap = {
    Miami: ['miami','mia','hq','headquarters','miramar'],
    FtLauderdale: ['lauderdale','ftl','ft.l','coral springs','broward'],
    Orlando: ['orlando','orl','central fl'],
    Tampa: ['tampa','tpa','west fl'],
    Ocala: ['ocala','oca','north fl']
  };
  let center = null;
  for (const [c, keywords] of Object.entries(centerMap)) {
    if (keywords.some(k => n.includes(k))) { center = c; break; }
  }

  // Category detection
  const catMap = {
    safety: ['security','safety','isow','volunteer registration','evacuation','lockdown','shelter','incident','drill','fire plan','positions','jamatkhana presentation','jamatkhana security','security plan'],
    eop:    ['emergency operating','eop','emergency procedure','response plan','continuity'],
    rec:    ['rec','religious education','curriculum','attendance','class','lesson','program schedule'],
    camps:  ['camp','camping','day camp','overnight','activity','outdoor']
  };
  let category = null;
  for (const [cat, keywords] of Object.entries(catMap)) {
    if (keywords.some(k => n.includes(k))) { category = cat; break; }
  }

  if (!category || !center) return null;
  return { category, center };
}

// ── Drive helpers ────────────────────────────────────────────────────────────
async function getToken() {
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const email = process.env.GOOGLE_SA_EMAIL;
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    iss:email, scope:'https://www.googleapis.com/auth/drive',
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
  if (!d.access_token) throw new Error('Token error: ' + JSON.stringify(d));
  return d.access_token;
}

async function driveGet(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}

async function listDump(token) {
  const url = `https://www.googleapis.com/drive/v3/files?q=%27${FOLDER_IDS.dump}%27+in+parents+and+trashed%3Dfalse&fields=files(id,name,mimeType)&pageSize=100`;
  const d = await driveGet(url, token);
  return d.files || [];
}

async function copyFile(fileId, destFolderId, fileName, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ name: fileName, parents: [destFolderId] })
  });
  return r.json();
}

async function shareWithSA(fileId, token) {
  const SA = process.env.GOOGLE_SA_EMAIL;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ role:'reader', type:'user', emailAddress: SA })
  });
  return r.ok;
}

async function deleteFile(fileId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method:'DELETE',
    headers:{ Authorization:`Bearer ${token}` }
  });
  return r.status === 204;
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  const results = { sorted: [], ambiguous: [], errors: [], dumpCleared: false };

  try {
    const token = await getToken();
    const files = await listDump(token);

    if (files.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ ...results, message: 'Dump folder is already empty' }) };
    }

    for (const file of files) {
      const dest = classify(file.name);

      if (!dest) {
        results.ambiguous.push({ id: file.id, name: file.name });
        continue;
      }

      const targetFolderId = FOLDER_IDS[dest.category]?.[dest.center];
      if (!targetFolderId) {
        results.errors.push({ name: file.name, error: `No folder ID for ${dest.category}/${dest.center}` });
        continue;
      }

      try {
        // 1. Copy to center folder
        const centerCopy = await copyFile(file.id, targetFolderId, file.name, token);
        if (centerCopy.error) throw new Error('Copy to center: ' + centerCopy.error.message);

        // 2. Share center copy with SA so dashboard can see it
        await shareWithSA(centerCopy.id, token);

        // 3. Copy original to Archive
        const archiveCopy = await copyFile(file.id, FOLDER_IDS.archive, file.name, token);
        if (archiveCopy.error) throw new Error('Copy to archive: ' + archiveCopy.error.message);

        // 4. Delete original from Dump
        await deleteFile(file.id, token);

        results.sorted.push({
          name: file.name,
          destination: `${dest.category}/${dest.center}`,
          archived: true
        });
      } catch (err) {
        results.errors.push({ name: file.name, error: err.message });
      }
    }

    // Check if dump is now empty
    const remaining = await listDump(token);
    results.dumpCleared = remaining.length === 0;
    results.remainingInDump = remaining.length;

    return { statusCode: 200, headers, body: JSON.stringify(results) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, ...results }) };
  }
};
