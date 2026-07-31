/** HTTP + WebSocket 入口。Render 上兩者共用同一個 port。 */
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';
import { registerHandlers } from './handlers.ts';

const PORT = Number(process.env.PORT ?? 3001);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_DIST = join(ROOT, 'client', 'dist');

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// 正式環境由 Express 一起托管打包好的前端；開發時走 Vite dev server
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => {
    res.sendFile(join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('UNO server 執行中。前端請跑 npm run dev:client（http://localhost:5173）');
  });
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: true, credentials: true },
  // Render free tier 冷啟較久，放寬一點避免誤判斷線
  pingTimeout: 25_000,
  pingInterval: 20_000,
});

registerHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`▶ UNO server listening on :${PORT}`);
  if (!existsSync(CLIENT_DIST)) console.log('  （尚未 build 前端，靜態托管已停用）');
});

const shutdown = () => {
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
