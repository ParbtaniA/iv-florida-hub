// Returns all unique section names from links-regional store
const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
function token() { return process.env.NETLIFY_BLOBS_TOKEN; }

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/links-regional`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    if (!r.ok) return { statusCode: 200, headers, body: JSON.stringify({ sections: [] }) };

    const { blobs = [] } = await r.json();
    // Keys are like "SectionName:link_id" — extract unique section names
    const sections = [...new Set(
      blobs.map(b => decodeURIComponent(b.key).split(':')[0]).filter(Boolean)
    )].sort();

    return { statusCode: 200, headers, body: JSON.stringify({ sections }) };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ sections: [], error: err.message }) };
  }
};
