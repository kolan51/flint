# Flint engineering notes

Tagline kept: a desktop app for a local model, or an API you already have.

Product direction for this branch: **Your AI engineering team. On your machine. From requirements to verified code.**

## What was already in Flint

- Multi-agent chat with Lead / Apply / Chat seats and prompt jobs
- Review dock, near-match edits, reply unified diffs, commit-on-keep
- Ranked repo map, Pyright + TypeScript language server
- Git worktrees for delegated workers, folder checks, MCP, memory notes

## What this branch adds

### Phase 1 — Security and worktree reliability

- Local API requires an `X-Flint-Token` (bootstrapped from `/api/boot` only for localhost same-origin)
- CORS limited to localhost origins; non-local `Host` and foreign `Origin` are rejected
- Worktree publish now applies deletes and binary files, reports conflicts instead of overwriting a dirty main file, and no longer silently drops deletions

### Phase 2 — Flint Tasks (vertical slice)

- Durable tasks under `<workspace>/.flint/tasks/*.json` (schema version 1)
- Lifecycle with enforced transitions; completion requires a verification report with at least one pass and no failures
- Propose → approve → implement → verify → review → complete in the Tasks dock
- Ordinary chat stays available for small edits

### Phase 3 — Verification (vertical slice)

- `server/verify.js` detects project checks (npm test/lint/build/typecheck, pytest) and runs them only when commands are allowed
- Reports distinguish passed, failed, skipped, and unavailable
- Task completion cannot be claimed from agent text alone

## Intentionally unfinished

- Full Architect / Implementer / Verifier / Reviewer orchestration for every task
- Automatic model routing modes and cost budgets
- Dedicated full-page engineering dashboard beyond the Tasks dock
- Benchmark suite against Turri or other tools
- Signing, cloud agents, marketplace, and a native PTY (still out of scope)

## Security boundary

Flint binds to `127.0.0.1`. That is not enough by itself. The token + localhost origin/host checks are meant to stop a random website from reading settings, writing files, or running terminal commands through the local API. Open Flint through the desktop app or the local Vite/dev URL so `/api/boot` can issue the token to that window only.
