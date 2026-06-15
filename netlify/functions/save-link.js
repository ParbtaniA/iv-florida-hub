const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
const TOKEN   = process.env.NETLIFY_BLOBS_TOKEN;

async function blobListAll(store) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!r.ok) return [];
  return (await r.json()).blobs || [];
}

async function blobGet(store, key) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${key}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!r.ok) return null;
  return r.json();
}

async function blobSet(store, key, value) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error('Blob write failed: ' + await r.text());
}

async function findDuplicate(store, name, url, keyPrefix) {
  const all = await blobListAll(store);
  for (const b of all) {
    const decodedKey = decodeURIComponent(b.key);
    if (!decodedKey.startsWith(keyPrefix)) continue;
    const item = await blobGet(store, b.key);
    if (!item) continue;
    if (item.name?.toLowerCase() === name?.toLowerCase() || item.url === url) {
      return item;
    }
  }
  return null;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { name, url, destination, category, center, section, force } = JSON.parse(event.body);
    if (!name || !url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'name and url required' }) };

    const id = `link_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const link = { id, name, url, createdAt: new Date().toISOString() };

    if (destination === 'regional' && section) {
      if (!force) {
        const existing = await findDuplicate('links-regional', name, url, `${section}:`);
        if (existing) return { statusCode: 200, headers, body: JSON.stringify({ duplicate: true, existing: { name: existing.name, url: existing.url } }) };
      }
      link.destination = 'regional'; link.section = section;
      await blobSet('links-regional', `${section}:${id}`, link);

    } else if (destination === 'center' && category && center) {
      if (!force) {
        const existing = await findDuplicate('links-center', name, url, `${category}:${center}:`);
        if (existing) return { statusCode: 200, headers, body: JSON.stringify({ duplicate: true, existing: { name: existing.name, url: existing.url } }) };
      }
      link.destination = 'center'; link.category = category; link.center = center;
      await blobSet('links-center', `${category}:${center}:${id}`, link);

    } else {
      link.destination = 'pending';
      await blobSet('links-pending', id, link);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
