// save-link.js — stores a named URL in Netlify Blobs
// Links can go to: regional/{section} or center/{category}/{center}
// If no exact location → stored in pending for admin review

const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
const TOKEN   = process.env.NETLIFY_BLOBS_TOKEN;

async function blobSet(store, key, value) {
  const url = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error('Blob write failed: ' + await r.text());
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const { name, url, destination, category, center, section } = JSON.parse(event.body);
    if (!name || !url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'name and url required' }) };

    const id = `link_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const link = { id, name, url, createdAt: new Date().toISOString() };

    if (destination === 'regional' && section) {
      // Goes to Regional tab under the given section
      link.destination = 'regional';
      link.section = section;
      await blobSet('links-regional', `${section}:${id}`, link);
    } else if (destination === 'center' && category && center) {
      // Goes to a specific center drawer
      link.destination = 'center';
      link.category = category;
      link.center = center;
      await blobSet('links-center', `${category}:${center}:${id}`, link);
    } else {
      // No exact location — goes to pending for admin review
      link.destination = 'pending';
      link.note = 'No location specified — needs admin review';
      await blobSet('links-pending', id, link);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
