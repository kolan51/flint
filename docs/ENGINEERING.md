# Flint engineering notes

Tagline kept: a desktop app for a local model, or an API you already have.

Product direction: **Your AI engineering team. On your machine. From requirements to verified code.**

## What was already in Flint

- Multi-agent chat with seats and prompt jobs
- Review dock, near-match edits, reply unified diffs, commit-on-keep
- Ranked repo map, Pyright + TypeScript language server
- Git worktrees for delegated workers, folder checks, MCP, memory notes

## Landed on `reliability/local-first-workspace`

### Phase 1 — Security and worktree reliability

- Local API requires an `X-Flint-Token` (from `/api/boot` for localhost same-origin only)
- CORS limited to localhost origins; non-local `Host` and foreign `Origin` are rejected
- Worktree publish applies deletes and binaries; dirty main-folder files become conflicts

### Phase 2 — Flint Tasks

- Durable tasks under `<workspace>/.flint/tasks/*.json` (schema version 1)
- Lifecycle with enforced transitions; completion needs a passing verification report
- Tasks dock: propose → approve → run crew / verify → complete
- Ordinary chat stays available for small edits

### Phase 3 — Verification

- `server/verify.js` detects project checks and runs them when commands are allowed
- Reports distinguish passed, failed, skipped, and unavailable

### Phase 4 — Multi-agent orchestration

- Seats: Chat, Lead, Architect, Implementer, Apply, Verifier, Reviewer
- Tool shapes: verifiers cannot edit; reviewers cannot edit or run commands
- `server/scheduler.js` assigns a crew, records activity, runs verification, bounds repair loops to 2

### Phase 5 — Model routing

- Settings modes: Custom, Local only, Balanced, Quality first
- `server/modelRouter.js` picks agents with an explicit reason
- Local only blocks remote provider addresses
- Cost fields stay empty unless a provider reports billing data

### Phase 6 — Task workspace

- Tasks dock shows phase, acceptance, plan, files, crew, verification evidence, and activity
- **Run crew** drives the scheduler without inventing progress percentages

### Phase 7 — DX

- README Tasks + routing notes
- This file
- `benchmarks/README.md`

### Phase 8 — Benchmarks

- `benchmarks/fixtures/calc-bug` and `node benchmarks/run.mjs`
- Offline, reproducible; no Turri comparison scores

## Still open / partial

- Broader benchmark suite and live-model evals against other tools
- Signing, cloud agents, marketplace, native PTY

## Fixed after the first reliability pass

- `/api/tasks/:id/run` streams live Architect (plan), Implementer (act), and Reviewer turns through `runAgentLoop`
- Settings → Model routing pins each role to a specific agent
- Full Tasks board modal (`Ctrl+K` → Tasks) outside the dock

## Security boundary

Flint binds to `127.0.0.1`. That is not enough by itself. The token + localhost origin/host checks stop a random website from reading settings, writing files, or running terminal commands through the local API.
