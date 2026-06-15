const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
function token() { return process.env.NETLIFY_BLOBS_TOKEN; }

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

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { store, section, category, center } = event.queryStringParameters || {};

  try {
    let storeName, filterFn;
    if (store === 'pending') { storeName = 'links-pending'; filterFn = () => true; }
    else if (store === 'regional' && section) { storeName = 'links-regional'; filterFn = k => decodeURIComponent(k).startsWith(`${section}:`); }
    else if (store === 'center' && category && center) { storeName = 'links-center'; filterFn = k => decodeURIComponent(k).startsWith(`${category}:${center}:`); }
    else return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid params' }) };

    const allBlobs = await blobList(storeName);
    const matching = allBlobs.filter(b => filterFn(b.key));
    const links = await Promise.all(matching.map(b => blobGet(storeName, b.key)));
    return { statusCode: 200, headers, body: JSON.stringify({ links: links.filter(Boolean).sort((a,b) => a.name.localeCompare(b.name)) }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
