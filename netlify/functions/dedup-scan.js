// dedup-scan.js — scans all center folders and Blobs link stores for duplicates
// Returns a report; optionally deletes duplicates if action=delete
const { createHmac } = require('crypto');
const { createSign } = require('crypto');

const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
function blobTok() { return process.env.NETLIFY_BLOBS_TOKEN; }

const FOLDERS = {
  'eop:Miami':'1jVrTx0C9iEmNrNKBR9jBRIfRhlh1DyAD','eop:FtLauderdale':'1gpcSGPhQYSw2IqJJuJxIM6L5i7OaTJ45',
  'eop:Orlando':'1MG8GQlyr1GtW0qY2naY7TRruGMGsU2cW','eop:Tampa':'1D_7igH1-S-p0bATOhG0b3ii51tZg2HRR','eop:Ocala':'1vfoo5356GfC68lDdeiVffT9NNaKJ4Rry',
  'safety:Miami':'1ieKjGv4Fv7YrQb-8JZ9KKzMq0lh4_qIo','safety:FtLauderdale':'1X-lsQxaFEH2aUE68RJBR1pQvBk2MXYYQ',
  'safety:Orlando':'1XI0LnP0U0yEk9NzD7OL3O9Sp67j4EgCa','safety:Tampa':'1NzXaNqpBs1N1BSytd4zv1hOARG9RImHf','safety:Ocala':'11Dc0bJC6A3nF2QWYg-wg5j2DMnMk8KrI',
  'rec:Miami':'10YqSvPui8lxfE31E4TpViKOqvliwmJ8G','rec:FtLauderdale':'1c89iBn9Vse3h3HxgT9nuD6i3MonNfJ3v',
  'rec:Orlando':'1Z0DYQkYsPXUYOS--o-BAiAcFN2qgT2cA','rec:Tampa':'1h6ra4O_LpF5bWgI6Xbo7M0S9MVk97yvB','rec:Ocala':'1ASR89ZA-mEfm1ayYRtqWV4Z1SeQTYyAh',
  'camps:Miami':'17xUbiAyEXkH00P7Lf1O9bU4Fjsk3deGF','camps:FtLauderdale':'1qKYp_IeAarga1SiZou1Rg16PofdEi4Cf',
  'camps:Orlando':'13epUEqPvVp0bmi98rX3znJMhLtAM8dVM','camps:Tampa':'1fKo-XKZGpcIUbSI2XkOj5CIlPKxCEKkY','camps:Ocala':'12QeCkZtXbBzdSOTjBWoeyerVSF9tWDa8',
};

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

async function getSAToken() {
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const email = process.env.GOOGLE_SA_EMAIL;
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({iss:email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const sign = createSign('RSA-SHA256'); sign.update(`${h}.${p}`);
  const sig = sign.sign(key,'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${sig}`});
  const d = await r.json();
  if (!d.access_token) throw new Error('SA token failed');
  return d.access_token;
}

async function getAdminDriveToken() {
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:process.env.ADMIN_REFRESH_TOKEN,grant_type:'refresh_token'})});
  const d = await r.json();
  return d.access_token || null;
}

async function listDriveFolder(folderId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=%27${folderId}%27+in+parents+and+trashed%3Dfalse&fields=files(id,name,modifiedTime)&pageSize=100`,{headers:{Authorization:`Bearer ${token}`}});
  const d = await r.json();
  return d.files || [];
}

async function deleteDriveFile(fileId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
  return r.status === 204;
}

async function listBlobStore(store) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`,{headers:{Authorization:`Bearer ${blobTok()}`}});
  if (!r.ok) return [];
  return (await r.json()).blobs || [];
}

async function getBlobItem(store, key) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${key}`,{headers:{Authorization:`Bearer ${blobTok()}`}});
  return r.ok ? r.json() : null;
}

async function deleteBlobItem(store, key) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${key}`,{method:'DELETE',headers:{Authorization:`Bearer ${blobTok()}`}});
  return r.ok || r.status === 204;
}

exports.handler = async (event) => {
  const headers = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return {statusCode:200,headers,body:''};
  if (event.httpMethod !== 'POST') return {statusCode:405,headers,body:'{}'};

  const admin = verifyAdmin(event.headers.cookie || '');
  if (!admin || admin.email !== process.env.ADMIN_EMAIL)
    return {statusCode:401,headers,body:JSON.stringify({error:'Unauthorized'})};

  const { action } = JSON.parse(event.body || '{}'); // action: 'scan' | 'delete'
  const report = { fileDuplicates: [], linkDuplicates: [], deleted: 0, errors: [] };

  try {
    // ── 1. Scan Drive folders ──
    let driveToken = await getAdminDriveToken().catch(() => null) || await getSAToken();

    await Promise.all(Object.entries(FOLDERS).map(async ([key, folderId]) => {
      const [cat, center] = key.split(':');
      try {
        const files = await listDriveFolder(folderId, driveToken);
        const seen = {};
        for (const f of files) {
          const norm = f.name.toLowerCase().trim();
          if (!seen[norm]) { seen[norm] = []; }
          seen[norm].push(f);
        }
        for (const [name, copies] of Object.entries(seen)) {
          if (copies.length < 2) continue;
          // Keep newest (highest modifiedTime), mark rest for deletion
          copies.sort((a,b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
          const toDelete = copies.slice(1);
          report.fileDuplicates.push({
            location: `${cat}/${center}`, name: copies[0].name,
            count: copies.length, keepId: copies[0].id,
            deleteIds: toDelete.map(f => f.id)
          });
          if (action === 'delete') {
            for (const f of toDelete) {
              const ok = await deleteDriveFile(f.id, driveToken).catch(() => false);
              if (ok) report.deleted++; else report.errors.push(`Drive delete failed: ${f.id}`);
            }
          }
        }
      } catch(e) { report.errors.push(`${key}: ${e.message}`); }
    }));

    // ── 2. Scan Blobs link stores ──
    const LINK_STORES = ['links-regional','links-center','links-pending'];
    await Promise.all(LINK_STORES.map(async (store) => {
      try {
        const blobs = await listBlobStore(store);
        const items = await Promise.all(blobs.map(b => getBlobItem(store, b.key).then(item => item ? { key: b.key, ...item } : null)));
        const valid = items.filter(Boolean);

        // Group by url
        const byUrl = {};
        for (const item of valid) {
          const k = item.url?.toLowerCase();
          if (!k) continue;
          if (!byUrl[k]) byUrl[k] = [];
          byUrl[k].push(item);
        }
        // Group by name within same location
        const byName = {};
        for (const item of valid) {
          const locKey = `${store}:${item.section || ''}:${item.category || ''}:${item.center || ''}:${item.name?.toLowerCase()}`;
          if (!byName[locKey]) byName[locKey] = [];
          byName[locKey].push(item);
        }

        const checkGroups = (groups) => {
          for (const [k, copies] of Object.entries(groups)) {
            if (copies.length < 2) continue;
            copies.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
            const toDelete = copies.slice(1);
            report.linkDuplicates.push({
              store, name: copies[0].name, url: copies[0].url,
              count: copies.length, keepKey: copies[0].key,
              deleteKeys: toDelete.map(i => i.key)
            });
            if (action === 'delete') {
              toDelete.forEach(async (item) => {
                const ok = await deleteBlobItem(store, item.key).catch(() => false);
                if (ok) report.deleted++; else report.errors.push(`Blob delete failed: ${store}/${item.key}`);
              });
            }
          }
        };
        checkGroups(byUrl);
        checkGroups(byName);
      } catch(e) { report.errors.push(`${store}: ${e.message}`); }
    }));

    return {statusCode:200,headers,body:JSON.stringify(report)};
  } catch(err) {
    return {statusCode:500,headers,body:JSON.stringify({error:err.message,...report})};
  }
};
