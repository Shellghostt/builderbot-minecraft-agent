# Cursor (Grok 4.7): local test runner and verifier (Claude, 2026-10-14)

GLM has hit its usage limit. A Claude cloud session (code-only, no game access) is working through `docs/CLOUD_TASK.md` and pushes its commits to `origin main`. Your job is the part only this PC can do: **run the live tests on whatever is on `main`, report honestly, and fix only what the tests show is broken.**

## Hard rules (unchanged, see AGENTS.md)
- Never kill processes by name; only `Stop-Agent.ps1`/supervisor `/stop`, PIDs in `data/processes.json`, or a verified project-port PID.
- Every node run `--max-old-space-size=2048`; `node --test` also `--test-timeout=60000`; everything with a timeout.
- **Model off**: `$env:AGENT_MODEL='off'` before every Start-Agent / soak. Never start llama-server.
- Never touch Crafty (8443), Nitrous (25567), SGSMP (25565), Geyser, playit, or the `crafty`, `MCSERVER`, `geyser`, `playit`, `andy-comparison`, `reference` folders.
- Test server stays `server-ip=0.0.0.0`; never kick/tp/gamemode/target players; every `@e` has `type=`; no `@a`/`@p`.
- One soak at a time. No test-fixture coordinates in `src/`; never make a test easier; report failures as failures.
- **Always restart the services (`Stop-Agent.ps1`, then `Start-Agent.ps1` with the model off) after pulling or editing code**, otherwise the running bot uses stale code.

## Git
`git pull --rebase` before every test run. Commit and push only your own fixes and reports, small and with clear messages. Do not rewrite or revert the cloud session's commits; if one of them breaks a test, fix forward in a separate commit and say why. Never force-push.

## Do, in order
1. `git pull --rebase`; run the unit tests (all `tests/*.test.js` except `resources.test.js`). Fix anything red.
2. Restart services. Run `python tests/integration.py` (must be green).
3. **Dual soak** (`python -u tests/soak.py`): this measures GLM's last unmeasured fixes (night branch using time-of-day instead of raw world age, hunts sweeping their own drops, anchored food-explore ceiling). Check specifically: does a `[night]` sleep or shelter job appear in the hard runs (dashboard log), is food obtained and eaten, any deaths and their causes.
4. After the cloud session pushes the creeper "pillar up" change and the iron step: pull, restart, run `python tests/combat_integration.py` (report both `4_creeper` and `4b_creeper_roofed` damage) and another dual soak. **At most 3 combat runs per change**; do not tune the creeper yourself beyond small bug fixes.
5. After every run, append a dated section to `docs/TEST_REPORTS.md`: commit tested (`git rev-parse --short HEAD`), unit/integration/combat results, soak table (wood/stone/furnace/food times, night sleep/shelter yes/no, deaths with causes), and the concrete bugs you saw. Commit and push it.

Keep going until all of the above is done or you hit your usage limit (write the report first).
