const { GoogleAuth } = require('google-auth-library');

const FOLDER_IDS = {
  root: '1ZFt0YQ7PPgjVZYub9KASijcPDsUWBTa8',
  eop: {
    Miami: '1jVrTx0C9iEmNrNKBR9jBRIfRhlh1DyAD',
    FtLauderdale: '1gpcSGPhQYSw2IqJJuJxIM6L5i7OaTJ45',
    Orlando: '1MG8GQlyr1GtW0qY2naY7TRruGMGsU2cW',
    Tampa: '1D_7igH1-S-p0bATOhG0b3ii51tZg2HRR',
    Ocala: '1vfoo5356GfC68lDdeiVffT9NNaKJ4Rry'
  },
  safety: {
    Miami: '1ieKjGv4Fv7YrQb-8JZ9KKzMq0lh4_qIo',
    FtLauderdale: '1X-lsQxaFEH2aUE68RJBR1pQvBk2MXYYQ',
    Orlando: '1XI0LnP0U0yEk9NzD7OL3O9Sp67j4EgCa',
    Tampa: '1NzXaNqpBs1N1BSytd4zv1hOARG9RImHf',
    Ocala: '11Dc0bJC6A3nF2QWYg-wg5j2DMnMk8KrI'
  },
  rec: {
    Miami: '10YqSvPui8lxfE31E4TpViKOqvliwmJ8G',
    FtLauderdale: '1c89iBn9Vse3h3HxgT9nuD6i3MonNfJ3v',
    Orlando: '1Z0DYQkYsPXUYOS--o-BAiAcFN2qgT2cA',
    Tampa: '1h6ra4O_LpF5bWgI6Xbo7M0S9MVk97yvB',
    Ocala: '1ASR89ZA-mEfm1ayYRtqWV4Z1SeQTYyAh'
  },
  camps: {
    Miami: '17xUbiAyEXkH00P7Lf1O9bU4Fjsk3deGF',
    FtLauderdale: '1qKYp_IeAarga1SiZou1Rg16PofdEi4Cf',
    Orlando: '13epUEqPvVp0bmi98rX3znJMhLtAM8dVM',
    Tampa: '1fKo-XKZGpcIUbSI2XkOj5CIlPKxCEKkY',
    Ocala: '12QeCkZtXbBzdSOTjBWoeyerVSF9tWDa8'
  }
};

const MIME_ICONS = {
  'application/vnd.google-apps.folder': 'folder',
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.presentation': 'slides',
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'video/mp4': 'video',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { folderId } = event.queryStringParameters || {};
  if (!folderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'folderId required' }) };
  }

  try {
    const keyRaw = process.env.GOOGLE_SA_KEY;
    const email = process.env.GOOGLE_SA_EMAIL;

    if (!keyRaw || !email) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing service account credentials' }) };
    }

    const privateKey = keyRaw.replace(/\\n/g, '\n');

    const auth = new GoogleAuth({
      credentials: { client_email: email, private_key: privateKey },
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&orderBy=folder,name&pageSize=100`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token.token}` }
    });

    const data = await resp.json();

    const files = (data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      type: MIME_ICONS[f.mimeType] || 'file',
      mimeType: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      modified: f.modifiedTime,
      size: f.size,
      viewLink: f.webViewLink
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ files, folderId })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
