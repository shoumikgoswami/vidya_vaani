// Imported first by every function, before the app reads its settings.
process.env.SERVERLESS = 'true';
process.env.DATA_DIR = '/tmp/vv';
process.env.PUBLIC_BASE_URL ||= process.env.URL || '';
