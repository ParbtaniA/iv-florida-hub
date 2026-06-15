const { getStore } = require('@netlify/blobs');

async function getBlobStore(storeName) {
  return getStore({ name: storeName, consistency: 'strong' });
}

async function quickDupeCheck(storeName, keyPrefix, name, url) {
  try {
    const store = await getBlobStore(storeName);
    const { blobs = [] } = await store.list({ prefix: keyPrefix });
    for (const b of blobs) {
      const item = await store.get(b.key, { type: 'json' });
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
      const store = await getBlobStore('links-regional');
      await store.setJSON(`${section}:${id}`, link);

    } else if (destination === 'center' && category && center && !customSection) {
      if (!force) {
        const existing = await quickDupeCheck('links-center', `${category}:${center}:`, name, url);
        if (existing) return { statusCode: 200, headers, body: JSON.stringify({ duplicate: true, existing: { name: existing.name, url: existing.url } }) };
      }
      link.destination = 'center'; link.category = category; link.center = center;
      const store = await getBlobStore('links-center');
      await store.setJSON(`${category}:${center}:${id}`, link);

    } else {
      link.destination = 'pending';
      const store = await getBlobStore('links-pending');
      await store.setJSON(id, link);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
