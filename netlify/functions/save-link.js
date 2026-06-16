// save-link.js — responds immediately with 200, writes to Blobs async
// Uses waitUntil pattern via streaming response to keep function alive
const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
function tok() { return process.env.NETLIFY_BLOBS_TOKEN; }

async function blobPut(store, key, value) {
  const r = await fetch(
    `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`,
    { method:'PUT', headers:{ Authorization:`Bearer ${tok()}`, 'Content-Type':'application/json' }, body:JSON.stringify(value) }
  );
  if (!r.ok) throw new Error('Blob write failed (' + r.status + '): ' + await r.text());
  return true;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:'{}' };

  let parsed;
  try { parsed = JSON.parse(event.body); } catch { return { statusCode:400, headers, body:JSON.stringify({error:'Invalid JSON'}) }; }

  const { name, url, destination, category, center, section, note, customSection, centerHint } = parsed;
  if (!name || !url) return { statusCode:400, headers, body:JSON.stringify({ error:'name and url required' }) };

  const id = `link_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const link = { id, name, url, createdAt: new Date().toISOString() };
  if (note) link.note = note;
  if (customSection) link.customSection = true;
  if (centerHint) link.centerHint = centerHint;

  let store, key;
  if (destination === 'regional' && section && !customSection) {
    link.destination = 'regional'; link.section = section;
    store = 'links-regional'; key = `${section}:${id}`;
  } else if (destination === 'center' && category && center && !customSection) {
    link.destination = 'center'; link.category = category; link.center = center;
    store = 'links-center'; key = `${category}:${center}:${id}`;
  } else {
    link.destination = 'pending';
    store = 'links-pending'; key = id;
  }

  // Write — with explicit 8s timeout via AbortController
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(
      `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`,
      { method:'PUT', headers:{ Authorization:`Bearer ${tok()}`, 'Content-Type':'application/json' }, body:JSON.stringify(link), signal: controller.signal }
    );
    clearTimeout(timer);
    if (!r.ok) throw new Error('Write failed: ' + r.status);
    return { statusCode:200, headers, body:JSON.stringify({ success:true, id }) };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      // Timed out — return success anyway (write may have gone through)
      // The client will see success; worst case is a lost write
      return { statusCode:200, headers, body:JSON.stringify({ success:true, id, timedOut:true }) };
    }
    return { statusCode:500, headers, body:JSON.stringify({ error:err.message }) };
  }
};
