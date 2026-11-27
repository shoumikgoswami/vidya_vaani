// Start-up never calls NVIDIA, OpenRouter or Clerk (spec 11).
import { config } from './config.js';
import { createApp } from './app.js';
import { startWorker, stopWorker } from './jobs/queue.js';
import { startSchedules } from './jobs/reminders.js';
import { vapidPublicKey } from './services/push.js';
import { seedDemo } from './db/seed-demo.js';
import { db } from './db/index.js';

vapidPublicKey();
const app = createApp();

const server = app.listen(config.port, '0.0.0.0', () => {
  const on = (flag) => (flag ? 'on' : 'off');
  console.log(`Vidya Vaani is running on ${config.publicBaseUrl} (port ${config.port})`);
  console.log(
    `demo ${on(config.demoMode)} | Clerk ${on(config.clerk.enabled)} | NVIDIA ${on(config.nvidia.apiKey)} | OpenRouter ${on(config.openrouter.apiKey)}`,
  );
});

startWorker();
startSchedules();
if (config.demoMode) seedDemo().catch((error) => console.error('demo data failed:', error));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopWorker();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
