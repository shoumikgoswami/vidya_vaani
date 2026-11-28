// Start-up never calls NVIDIA, OpenRouter or Clerk (spec 11).
import { config } from './config.js';
import { createApp } from './app.js';
import { startWorker, stopWorker } from './jobs/queue.js';
import { startSchedules } from './jobs/reminders.js';
import { vapidPublicKey } from './services/push.js';
import { seedDemo } from './db/seed-demo.js';
import { migrate, close } from './db/index.js';

await migrate();
await vapidPublicKey();
if (config.demoMode) await seedDemo().catch((error) => console.error('demo data failed:', error));

const app = createApp();
await startWorker();
startSchedules();

const server = app.listen(config.port, '0.0.0.0', () => {
  const on = (flag) => (flag ? 'on' : 'off');
  console.log(`Vidya Vaani is running on ${config.publicBaseUrl} (port ${config.port})`);
  console.log(
    `demo ${on(config.demoMode)} | Clerk ${on(config.clerk.enabled)} | NVIDIA ${on(config.nvidia.apiKey)} | OpenRouter ${on(config.openrouter.apiKey)}`,
  );
  console.log(`database: ${config.databaseUrl.startsWith('postgres') ? 'hosted Postgres' : 'built in, in the data folder'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopWorker();
    // Close the database cleanly even if a browser keeps a connection open.
    server.closeAllConnections();
    server.close(async () => {
      await close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
