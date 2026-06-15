// save-link.js — raw Netlify Blobs REST API with write-capable token
const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';

function token() { return process.env.NETLIFY_BLOBS_TOKEN; }

async function blobPut(store, key, value) {
  const r = await fetch(
    `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error('Blob write failed: ' + err);
  }
}

async function blobList(store) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) return [];
  return (await r.json()).blobs || [];
}

async function blobGet(store, key) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${key}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) return null;
  return r.json();
}

async function quickDupeCheck(store, keyPrefix, name, url) {
  try {
    const blobs = await blobList(store);
    const matching = blobs.filter(b => decodeURIComponent(b.key).startsWith(keyPrefix));
    for (const b of matching) {
      const item = await blobGet(store, b.key);
      if (!item) continue;
      if (item.name?.toLowerCase() === name?.toLowerCase() || item.url === url) return item;
    }
    return null;
  } catch { return null; }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { name, url, destination, category, center, section, force, note, customSection, centerHint } = JSON.parse(event.body);
    if (!name || !url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'name and url required' }) };

    const id = `link_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const link = { id, name, url, createdAt: new Date().toISOString() };
    if (note) link.note = note;
    if (customSection) link.customSection = true;
    if (centerHint) link.centerHint = centerHint;

    if (destination === 'regional' && section && !customSection) {
      if (!force) {
        const existing = await quickDupeCheck('links-regional', `${section}:`, name, url);
        if (existing) return { statusCode: 200, headers, body: JSON.stringify({ duplicate: true, existing: { name: existing.name, url: existing.url } }) };
      }
      link.destination = 'regional'; link.section = section;
      await blobPut('links-regional', `${section}:${id}`, link);

    } else if (destination === 'center' && category && center && !customSection) {
      if (!force) {
        const existing = await quickDupeCheck('links-center', `${category}:${center}:`, name, url);
        if (existing) return { statusCode: 200, headers, body: JSON.stringify({ duplicate: true, existing: { name: existing.name, url: existing.url } }) };
      }
      link.destination = 'center'; link.category = category; link.center = center;
      await blobPut('links-center', `${category}:${center}:${id}`, link);

    } else {
      link.destination = 'pending';
      await blobPut('links-pending', id, link);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
