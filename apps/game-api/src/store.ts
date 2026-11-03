import pg from 'pg';
import type { EngineData } from './engine.js';
import type { GameInputEvent } from '@di-lam/shared';

export class Store {
  readonly mode = process.env.DATABASE_URL ? 'postgres' : 'memory';
  private client?: pg.Client;
  constructor(private readonly roomId: string) {}
  async open(): Promise<EngineData | undefined> {
    if (this.mode === 'memory') return;
    this.client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    this.client.on('error', error => console.error('PostgreSQL unavailable; writes will fail closed:', error.message));
    await this.client.connect();
    const lock = await this.client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [this.roomId]);
    if (!lock.rows[0]?.locked) throw new Error('Another game server already owns this room. Run one authoritative server per room.');
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS game_rooms (room_id text PRIMARY KEY, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS game_events (id bigserial PRIMARY KEY, room_id text NOT NULL, event_id text NOT NULL, source text NOT NULL, event_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS game_events_room_time ON game_events(room_id, created_at);
      DELETE FROM game_events WHERE created_at < now() - interval '7 days';
    `);
    const saved = await this.client.query('SELECT snapshot FROM game_rooms WHERE room_id=$1', [this.roomId]);
    const data = saved.rows[0]?.snapshot as EngineData | undefined;
    if (data && (data.version !== 1 || data.roomId !== this.roomId)) throw new Error('Unsupported saved game version. Back up the database before migration.');
    return data;
  }
  async save(snapshot: EngineData, event?: GameInputEvent) {
    if (!this.client) return;
    await this.client.query('BEGIN');
    try {
      await this.client.query('INSERT INTO game_rooms(room_id,snapshot) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,updated_at=now()', [this.roomId, JSON.stringify(snapshot)]);
      if (event) await this.client.query('INSERT INTO game_events(room_id,event_id,source,event_type) VALUES($1,$2,$3,$4)', [this.roomId, event.eventId, event.source, event.type]);
      await this.client.query('COMMIT');
    } catch (error) { await this.client.query('ROLLBACK').catch(() => {}); throw error; }
  }
  async close() { await this.client?.end(); }
}
