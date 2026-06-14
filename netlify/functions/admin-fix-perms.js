const { createSign } = require('crypto');

const SAFETY_FILES = [
  '19KnW3v1Dc746H038gHDQ-iCUvrTyt3ny','1wP2ZUU-OaZZ6KCs6WGyyW2XAOsasgurQ',
  '1JKnX7yBvG3oHi3S5rNoy6dVdsoo_PIu2','1zDl9kHJ6hUAVeivdWXaW67jeZfvfONZ1','1n6Cn3vXBkhxiV--jX8Pi1r76MDJD5yx-',
  '1YqtrYfc-uxrghRddNAE-uyqxA6EudgtH','1zAuxTaHlrUQe4rhMNxjWK_JzI72zOcJL',
  '1qdl-Abj5FMBWENiluuqXlsGWFxagdP2U','1QnPhSVuy_GQioxss17J7_2LPQVWDIK2H','1NWHgt1quZF89QOgiYFRUsPsnye2Nmh2T',
  '1yl5BZnWJBfdAMKx6jWq_2Nh3Ibcuc1yq','1ipJe_1R2xCb2Dirc_SVyTtj8NK9D_m1t',
  '1tjpL1v_XDNDbB0EF0wtu5PtInaVsIRFC','1euZYzf02ViX_qaAxYduY0MbiNKsA4sWa',
  '1pde3uUluCAwGl9rGg0l4S1O9t5rGroK5'
];

const DUMP_FILES = [
  '1uz7q5cG7d9FTZiDxxaTYcARqUReIvJ3m','1Iq13agBRgJpZtPkWONebphSZYWtCLxkC',
  '1s1L3XnSEBDQUohCX2yYE91VHkiOERMil','1gGHig_1UPkA2AV4ttUoNY6wERQCfa5mt',
  '117YVzzi4kzMv01EqgqRcBRiOF19FBVKF','1hxrpeTxclfq7J4uSnF0s7pYnE0JAaiY6',
  '1VuG1FzfASRy5Uh_hE64vWew0kLErG3Kz','1GpHWBB48jI8bzegV0nLHuWWnnkJIIMPr',
  '19wirz-0fQy59gdRiZ3NXfpsFP52mW12s','1tPXCuGhhTX11e-hkuRQQgr63sRKhSFlT',
  '1yhBYX8R3vUH3uDOmnzAJ0sQwB7pSTDFa','1-ENo7VL3dLlxSd4SvGcNxkzWt28cEy0O',
  '1N2hpL_dkO4n1Wwy58EHJBUMn8dIUjSoa','1kXBGDR6cWYIzbr3WY_aTnwNKdB5PgZVh',
  '1VAZoazhCD18CFwHRRefWxeWMje9mMtwm'
];

async function getToken() {
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const email = process.env.GOOGLE_SA_EMAIL;
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({iss:email, scope:'https://www.googleapis.com/auth/drive', aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now})).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${h}.${p}`);
  const sig = sign.sign(key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${sig}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token: ' + JSON.stringify(d));
  return d.access_token;
}

exports.handler = async (event) => {
  const headers = {'Content-Type':'application/json'};
  if (event.httpMethod !== 'POST') return {statusCode:405, headers, body:'{}'};
  const SA = process.env.GOOGLE_SA_EMAIL;
  try {
    const token = await getToken();
    const shareBody = JSON.stringify({role:'reader', type:'user', emailAddress: SA});
    let shared = 0, stripped = 0;

    // Share Safety files with SA
    for (const id of SAFETY_FILES) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
        method:'POST', headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body: shareBody
      });
      if (r.ok || (await r.json()).error?.message?.includes('already')) shared++;
    }

    // Strip SA from Dump originals
    for (const id of DUMP_FILES) {
      const pr = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?fields=permissions(id,emailAddress)`, {headers:{Authorization:`Bearer ${token}`}});
      const pd = await pr.json();
      const perm = (pd.permissions||[]).find(p => p.emailAddress === SA);
      if (perm) {
        const dr = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions/${perm.id}`, {method:'DELETE', headers:{Authorization:`Bearer ${token}`}});
        if (dr.status === 204) stripped++;
      }
    }

    return {statusCode:200, headers, body: JSON.stringify({success:true, shared, stripped})};
  } catch(err) {
    return {statusCode:500, headers, body: JSON.stringify({error:err.message})};
  }
};
