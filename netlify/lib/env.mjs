// Imported first by every function, before the app reads its settings.
process.env.SERVERLESS = 'true';
process.env.DATA_DIR = '/tmp/vv';
// Netlify always sits in front, whatever a copied .env says. Without this, cookies and Clerk
// sign-in would treat the site as plain http.
process.env.TRUST_PROXY = 'true';
process.env.PUBLIC_BASE_URL ||= process.env.URL || '';
