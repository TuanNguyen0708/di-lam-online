import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { GameController } from './controller.js';
import { GameService } from './game.service.js';
import { TikTokService } from './tiktok.service.js';
import { GameGateway } from './gateway.js';
import { AdminGuard } from './auth.js';
import { TtsService } from './tts.js';

@Module({ controllers: [GameController], providers: [GameService, TikTokService, TtsService, GameGateway, AdminGuard] })
class AppModule {}
async function main() {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 32) throw new Error('ADMIN_TOKEN must have at least 32 characters. Run pnpm run setup first.');
  const port = Number(process.env.PORT || 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: '8kb' }));
  app.enableShutdownHooks();
  app.enableCors({ origin: [process.env.WEB_ORIGIN || 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://lvh.me:5174'] });
  const limits = new Map<string, { time: number; count: number }>();
  app.use('/api/admin', (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const now = Date.now(), key = request.ip || 'unknown';
    for (const [ip, bucket] of limits) if (now - bucket.time >= 1000) limits.delete(ip);
    const bucket = limits.get(key) ?? { time: now, count: 0 };
    if (limits.size > 10000 || ++bucket.count > 120) { response.status(429).json({ message: 'Too many requests' }); return; }
    limits.set(key, bucket); next();
  });
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../game-web/dist');
  if (existsSync(web)) app.use(express.static(web));
  await app.listen(port, process.env.HOST || '127.0.0.1');
  console.log(`Game API http://127.0.0.1:${port} | Dashboard http://localhost:5174 | Stage /?view=stage`);
}
main().catch(error => { console.error(error); process.exit(1); });
