// Imported first by one-off scripts: they use a throwaway database, so they never open the app's
// own files while it is running, and never write to the hosted one.
process.env.DATABASE_URL = 'memory:';
