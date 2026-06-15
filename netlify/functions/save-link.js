const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
const TOKEN   = process.env.NETLIFY_BLOBS_TOKEN;

async function blobSet(store, key, value) {
  const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error('Blob write failed: ' + await r.text());
}

// Lightweight duplicate check — list only, no individual fetches
// Just checks key names for matching section/location prefix + name match
async function quickDupeCheck(store, keyPrefix, name, url) {
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    if (!r.ok) return null;
    const { blobs = [] } = await r.json();
    // Filter to same location prefix
    const matching = blobs.filter(b => decodeURIComponent(b.key).startsWith(keyPrefix));
    // Fetch only matching ones — usually 0–5, not the whole store
    for (const b of matching) {
      const gr = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${b.key}`, {
        headers: { Authorization: `Bearer ${TOKEN}` }
      });
      if (!gr.ok) continue;
      const item = await gr.json();
      if (item.name?.toLowerCase() === name?.toLowerCase() || item.url === url) return item;
    }
    return null;
  } catch { return null; } // non-blocking — skip dupe check on error
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
        const existing = await quickDupeCheck('links-regional', `${section}:`, name, url);
        if (existing) return { statusCode: 200, headers, body: JSON.stringify({ duplicate: true, existing: { name: existing.name, url: existing.url } }) };
      }
      link.destination = 'regional'; link.section = section;
      await blobSet('links-regional', `${section}:${id}`, link);

    } else if (destination === 'center' && category && center) {
      if (!force) {
        const existing = await quickDupeCheck('links-center', `${category}:${center}:`, name, url);
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
