const SITE_ID = '3bfe8c7b-192d-4d4d-aa10-6aced98a037c';
function tok() { return process.env.NETLIFY_BLOBS_TOKEN; }

async function blobPut(store, key, value) {
  const r = await fetch(
    `https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${encodeURIComponent(key)}`,
    { method:'PUT', headers:{ Authorization:`Bearer ${tok()}`, 'Content-Type':'application/json' }, body:JSON.stringify(value) }
  );
  if (!r.ok) throw new Error('Blob write failed: ' + await r.text());
}

// Check for dupes with a strict timeout — if it takes too long, skip and save anyway
async function quickDupeCheck(store, keyPrefix, name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000); // 4s max
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}`, {
      headers:{ Authorization:`Bearer ${tok()}` },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const blobs = (await r.json()).blobs || [];
    const matching = blobs.filter(b => decodeURIComponent(b.key).startsWith(keyPrefix));
    if (matching.length === 0) return null; // nothing there — skip fetches

    // Fetch matching ones in parallel (usually 0-5)
    const items = await Promise.all(matching.map(b =>
      fetch(`https://api.netlify.com/api/v1/blobs/${SITE_ID}/${store}/${b.key}`, {
        headers:{ Authorization:`Bearer ${tok()}` }
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    ));
    return items.find(i => i && (i.name?.toLowerCase() === name?.toLowerCase() || i.url === url)) || null;
  } catch {
    clearTimeout(timeout);
    return null; // timeout or error — skip dupe check, allow save
  }
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:'{}' };

  try {
    const { name, url, destination, category, center, section, force, note, customSection, centerHint } = JSON.parse(event.body);
    if (!name || !url) return { statusCode:400, headers, body:JSON.stringify({ error:'name and url required' }) };

    const id = `link_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const link = { id, name, url, createdAt: new Date().toISOString() };
    if (note) link.note = note;
    if (customSection) link.customSection = true;
    if (centerHint) link.centerHint = centerHint;

    if (destination === 'regional' && section && !customSection) {
      if (!force) {
        const existing = await quickDupeCheck('links-regional', `${section}:`, name, url);
        if (existing) return { statusCode:200, headers, body:JSON.stringify({ duplicate:true, existing:{ name:existing.name, url:existing.url } }) };
      }
      link.destination = 'regional'; link.section = section;
      await blobPut('links-regional', `${section}:${id}`, link);

    } else if (destination === 'center' && category && center && !customSection) {
      if (!force) {
        const existing = await quickDupeCheck('links-center', `${category}:${center}:`, name, url);
        if (existing) return { statusCode:200, headers, body:JSON.stringify({ duplicate:true, existing:{ name:existing.name, url:existing.url } }) };
      }
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
