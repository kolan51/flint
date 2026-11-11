# Flint benchmarks

Reproducible fixtures for measuring Flint’s task and verification path.

## Rules

- Use isolated folders under `fixtures/`.
- Record commands, exit codes, and statuses that actually ran.
- Do not invent competitor scores or model prices.
- Cost fields stay `null` unless a provider returns billing data.

## Calc bug

```bash
node benchmarks/run.mjs
```

This fixture starts with a failing `divide(1, 0)` test, applies a known repair, runs verification again, and writes a JSON result under `benchmarks/results/`.

Measured fields:

1. Task completion accuracy
2. Acceptance-criteria pass rate
3. Failing checks before and after
4. Repair iterations
5. Latency
6. Model routing choice (offline in this fixture)
7. Cost (null unless reported)

## Adding a fixture

1. Create `benchmarks/fixtures/<name>/` with code and `task.json`.
2. Make the starting state fail the intended check.
3. Teach the runner how to repair it, or leave a step for a live agent.
4. Keep the methodology note in the result JSON.
