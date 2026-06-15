// get-links.js — retrieves links for a location
// ?store=regional&section=SOPs  → regional links for that section
// ?store=center&category=safety&center=Miami  → center links

const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
const TOKEN   = process.env.NETLIFY_BLOBS_TOKEN;

async function blobList(store, prefix) {
  const url = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}${prefix ? '?prefix=' + encodeURIComponent(prefix) : ''}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return [];
  const d = await r.json();
  return d.blobs || [];
}

async function blobGet(store, key) {
  const r = await fetch(
    `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!r.ok) return null;
  return r.json();
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { store, section, category, center } = event.queryStringParameters || {};

  try {
    let blobs = [];

    if (store === 'regional' && section) {
      blobs = await blobList('links-regional', `${section}:`);
    } else if (store === 'center' && category && center) {
      blobs = await blobList('links-center', `${category}:${center}:`);
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid params' }) };
    }

    const links = await Promise.all(blobs.map(b => blobGet(
      store === 'regional' ? 'links-regional' : 'links-center',
      b.key
    )));

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ links: links.filter(Boolean).sort((a,b) => a.name.localeCompare(b.name)) })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
