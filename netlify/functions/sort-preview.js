// sort-preview.js — reads _Dump, classifies each file, returns a plan
// No Drive writes. SA read-only is sufficient.
const { createSign } = require('crypto');

const DUMP_ID = '1T3ADK73rj5CizyVIZ6popjiYjgFUZAqY';

const FOLDER_IDS = {
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

function classify(name) {
  const n = name.toLowerCase();

  // Exact-match overrides for known files with no center keyword
  const knownFiles = {
    'safety team positions': { category: 'safety', center: 'Miami' },
  };
  for (const [pattern, dest] of Object.entries(knownFiles)) {
    if (n.includes(pattern)) {
      const folderId = FOLDER_IDS[dest.category]?.[dest.center];
      if (folderId) return { ...dest, folderId };
    }
  }
  const centerMap = {
    Miami:        ['miami','mia','hq','headquarters','miramar'],
    FtLauderdale: ['lauderdale','ftl','ft.l','coral springs','broward'],
    Orlando:      ['orlando','orl','central fl'],
    Tampa:        ['tampa','tpa','west fl'],
    Ocala:        ['ocala','oca','north fl']
  };
  const catMap = {
    safety: ['security plan','safety plan','safety team','isow','volunteer registration','evacuation',
             'lockdown','shelter','incident','drill','fire plan','positions','jamatkhana presentation',
             'jamatkhana security','security'],
    eop:    ['emergency operating','eop','emergency procedure','response plan','continuity'],
    rec:    ['rec','religious education','curriculum','attendance','class','lesson','program schedule'],
    camps:  ['camp','camping','day camp','overnight','activity','outdoor']
  };
  let center = null;
  for (const [c, kws] of Object.entries(centerMap)) {
    if (kws.some(k => n.includes(k))) { center = c; break; }
  }
  let category = null;
  for (const [cat, kws] of Object.entries(catMap)) {
    if (kws.some(k => n.includes(k))) { category = cat; break; }
  }
  if (!category || !center) return null;
  const folderId = FOLDER_IDS[category]?.[center];
  if (!folderId) return null;
  return { category, center, folderId };
}

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
  if (!d.access_token) throw new Error('Token: ' + JSON.stringify(d));
  return d.access_token;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const token = await getToken();
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=%27${DUMP_ID}%27+in+parents+and+trashed%3Dfalse&fields=files(id,name,mimeType)&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const files = data.files || [];

    if (files.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ empty: true, plan: [], ambiguous: [] }) };
    }

    const plan = [], ambiguous = [];
    for (const f of files) {
      const dest = classify(f.name);
      if (dest) {
        plan.push({ id: f.id, name: f.name, mimeType: f.mimeType, ...dest });
      } else {
        ambiguous.push({ id: f.id, name: f.name, mimeType: f.mimeType });
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ empty: false, plan, ambiguous }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
