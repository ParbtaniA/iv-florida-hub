// save-link.js — write first, dupe check only on explicit retry
// This avoids the Blobs list call blocking the write path entirely
const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
function tok() { return process.env.NETLIFY_BLOBS_TOKEN; }

async function blobPut(store, key, value) {
  const r = await fetch(
    `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`,
    { method:'PUT', headers:{ Authorization:`Bearer ${tok()}`, 'Content-Type':'application/json' }, body:JSON.stringify(value) }
  );
  if (!r.ok) throw new Error('Blob write failed (' + r.status + '): ' + await r.text());
}

async function blobList(store) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`, {
      headers:{ Authorization:`Bearer ${tok()}` }, signal: controller.signal
    });
    clearTimeout(timeout);
    if (!r.ok) return [];
    return (await r.json()).blobs || [];
  } catch { clearTimeout(timeout); return []; }
}

async function blobGet(store, key) {
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${key}`, {
      headers:{ Authorization:`Bearer ${tok()}` }
    });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function checkDupe(store, keyPrefix, name, url) {
  const blobs = await blobList(store);
  const matching = blobs.filter(b => decodeURIComponent(b.key).startsWith(keyPrefix));
  if (!matching.length) return null;
  const items = await Promise.all(matching.map(b => blobGet(store, b.key)));
  return items.find(i => i && (i.name?.toLowerCase() === name?.toLowerCase() || i.url === url)) || null;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:'{}' };

  try {
    const { name, url, destination, category, center, section, force, note, customSection, centerHint, checkOnly } = JSON.parse(event.body);
    if (!name || !url) return { statusCode:400, headers, body:JSON.stringify({ error:'name and url required' }) };

    // checkOnly mode — used for async dupe check after save
    if (checkOnly) {
      if (destination === 'regional' && section) {
        const ex = await checkDupe('links-regional', `${section}:`, name, url);
        return { statusCode:200, headers, body:JSON.stringify({ duplicate: !!ex, existing: ex ? { name:ex.name, url:ex.url } : null }) };
      }
      if (destination === 'center' && category && center) {
        const ex = await checkDupe('links-center', `${category}:${center}:`, name, url);
        return { statusCode:200, headers, body:JSON.stringify({ duplicate: !!ex, existing: ex ? { name:ex.name, url:ex.url } : null }) };
      }
      return { statusCode:200, headers, body:JSON.stringify({ duplicate:false }) };
    }

    const id = `link_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const link = { id, name, url, createdAt: new Date().toISOString() };
    if (note) link.note = note;
    if (customSection) link.customSection = true;
    if (centerHint) link.centerHint = centerHint;

    // Write directly — no blocking dupe check before write
    if (destination === 'regional' && section && !customSection) {
      link.destination = 'regional'; link.section = section;
      await blobPut('links-regional', `${section}:${id}`, link);
    } else if (destination === 'center' && category && center && !customSection) {
      link.destination = 'center'; link.category = category; link.center = center;
      await blobPut('links-center', `${category}:${center}:${id}`, link);
    } else {
      link.destination = 'pending';
      await blobPut('links-pending', id, link);
    }

    return { statusCode:200, headers, body:JSON.stringify({ success:true, id }) };
  } catch (err) {
    return { statusCode:500, headers, body:JSON.stringify({ error:err.message }) };
  }
};
