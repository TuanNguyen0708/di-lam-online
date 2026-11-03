# Local verification — 2026-11-02

Windows, Node 22.23.4, pnpm 10.34.5. Not a claim about TikTok delivery latency or the streaming PC's production FPS.

## 3D stage redesign

- Replaced Phaser with Three.js. `pnpm.cmd build` passes; the lazy 3D bundle is about 521 KB uncompressed / 129 KB gzip, with Vite's standard large-chunk warning.
- `node --import tsx --test tests/engine.test.ts tests/office-layout.test.ts`: 12 tests pass, including seat/name boundaries, 3D-to-HTML ground projection and all fifty employees rotating without duplicate seats.
- Isolated headless Chromium verifies 1080x1920 stage, 390x844 phone, 1440x900 dashboard and narrow dashboard. Office measures 1080x1440: exactly 75% of stage height. No internal canvas letterboxing, overlapping rows, overlapping employee names or horizontal scrolling.
- Ten/fifty-player snapshots, long Vietnamese names, fifteen concurrent effects, automatic twelve-second floor rotation, pause, defeated boss, reduced motion, initial loading, 3D-load failure and locked admin controls are checked. WebSocket snapshots are mocked inside the test browser; no mutations are sent to the running game.
- Screenshots and measured checks: `docs/stage-layout/`. Full names use two-line HTML labels, not WebGL text. GPU FPS and actual OBS/WebGL compatibility on the broadcast setup still need checking.

## Original 2D baseline

- `pnpm build`: API and Vite/React/Phaser build pass. Phaser's lazy-loaded bundle is about 1.2 MB uncompressed (332 KB gzip); Vite emits its standard large-chunk warning.
- `pnpm typecheck`: all workspace projects pass.
- `pnpm test`: 9 tests pass (commands, validation, dedupe, cooldown/energy, voting/gift fairness, pause/rounds/resign, bounded state, HR chain, one-time boss reward, v3 normalization/streaks).
- `pnpm test:api`: HTTP auth, validation, input ownership and idempotency pass. Durable test is skipped unless both database URLs are set.
- Durable integration also run separately against real PostgreSQL 17 / Redis 7 in Docker: committed player state, boss HP, session identity and duplicate protection survive API process termination/restart. Pass.
- Simulator: 50 employees + 300 actions, 350 HTTP requests, 225 gameplay accepted, 125 expected cooldown/energy rejections, 0 HTTP errors; acknowledgement p95 8.55 ms on this machine. This is a paced load, not a 1,000-comment burst benchmark.
- OpenAPI syntax lint: no issues. Postman collection lint: 0 errors / 0 warnings. Public smoke collection: 2 requests, 7 assertions, 0 failures, exit 0; no cloud publishing.

Postman run output:

```text
GET http://127.0.0.1:3101/api/health [200 OK, 279 B, 33 ms]
Pass  Health returns 200
Pass  Game initialized
Pass  Storage mode is explicit
GET http://127.0.0.1:3101/api/state [200 OK, 2.8 KB, 6 ms]
Pass  State returns 200
Pass  Room and session are defined
Pass  Visible players and effects are bounded
Pass  Boss HP is bounded
requests: 2 executed, 0 failed
assertions: 7 executed, 0 failed
```

Not verified: a real TikTok LIVE account / gifts, vendor signing availability, OBS capture on the owner's broadcast setup, sustained 1,000-viewer traffic, Docker game image build. Do not use the experimental adapter or unmoderated display names in a public broadcast without checking these boundaries.
