const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { store, section, category, center } = event.queryStringParameters || {};

  try {
    let storeName, prefix;

    if (store === 'pending') {
      storeName = 'links-pending'; prefix = '';
    } else if (store === 'regional' && section) {
      storeName = 'links-regional'; prefix = `${section}:`;
    } else if (store === 'center' && category && center) {
      storeName = 'links-center'; prefix = `${category}:${center}:`;
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid params' }) };
    }

    const blobStore = getStore({ name: storeName, consistency: 'strong' });
    const { blobs = [] } = await blobStore.list(prefix ? { prefix } : {});
    const links = await Promise.all(blobs.map(b => blobStore.get(b.key, { type: 'json' })));
    const filtered = links.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    return { statusCode: 200, headers, body: JSON.stringify({ links: filtered }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
