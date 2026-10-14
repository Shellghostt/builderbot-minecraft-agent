# Live test reports (Cursor)

Local verifier for whatever is on `origin main`. Model off. No name-kills. No second soak. Test server stays `server-ip=0.0.0.0`, world `agent-test-world`.

## 2026-10-14 15:18–15:52 IST — units and integration (`7cecac9` + local fixes)

`git pull --rebase` was already up to date at `7cecac9` (cloud commits `c3c0ce6`..`10112de` plus the tester brief). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000`: **222 passed, 0 failed**.

Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`. Port 8081 closed.

### Integration

| Run | Result | Where it stopped |
| --- | --- | --- |
| 1 | fail | Sleep. Dashboard: `Mob Defense engaging`, armor equips, `Server set position to (452, -63, 450)`, `Sleeping through this night`, then **You are sending too many packets!** The job never reached `Sleeping until morning`. |
| 2 | fail | First gather, `badColumns ["3,4"]`. The bot had been kicked at the bed and the origin floor had been filled solid at foot level while recovering the world. Not a code failure. |
| 3 | fail | Fresh restart. Gather, explore, chest craft passed. **Same packet kick** at the sleep site (09:39:37Z). Reproduced. |
| 4 | fail | After pacing `position_look`. Sleep, shelter, fight passed. Smelt died in 1 s: `destination full` on a leftover furnace within 16 of (800, -60, 800). |
| 5 | fail | That furnace removed. Smelt **completed** and the ingots were real. `pickUp` then dug the furnace with no pickaxe (`give_kit` is leather only) and the drop never entered the inventory (`Left the furnace at (800, -60, 799)`, block gone, `furnace` count 0). The nearby-furnace assert failed. A trial edit of that assert was reverted. |
| 6 | **pass** | `All in-game integration tests passed` at 10:22:40Z, 1081 s. A4 lava escape hp 18.8. |

### Fixes (loaded for run 6, not yet the cloud commits)

- `src/compat.js` — `position_look` shares the 30/s movement cap. A look every tick was turning the physics flood into uncapped `position_look` packets. Pure `look` stays uncapped.
- `src/worker.js` — a furnace this job placed is picked up only when a pickaxe is in the inventory. With no pickaxe it stays in the world, which is what the smelt assert checks. The ladder still picks it up after the stone step.

Combat and the dual soak are next. At most 3 combat runs.

## 2026-10-14 15:54 IST — combat run 1 of 3 (`5c2ff8d`)

`python tests/combat_integration.py`, model off, same services as the green integration. Exit 1. Two failures, neither is a mirrored-heading symptom:

- `test2_zombie_triple`: `Health below 8; retreated from zombie`.
- `test4b_creeper_roofed`: the spawn-corner dirt assert passed; the arena-center dirt assert timed out (execute-if stayed silent). The fight itself had already finished.

### Yaw / pillar / arrows

Lane creeper (`4_creeper`): one shot at d=14.1, then the gap opened 14.1 → 16.0 in 0.5 s. The job finished as **repelled** (creeper left alive, no crater on the three dirt samples). Recorded `damage_taken=0`, `hits=0`, `shots=1`. **End health was 3.86**, so the bot lost about 16 hp that the scoreboard did not count. No `pillar` line on this leg (it built the LOS wall instead).

Roofed creeper (`4b`): `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.9)`, perched 2 up (the roof leaves no third block), one shot, `hits=0`. The log says `arrow no arrow entity found near the release` while an arrow name was visible. Server confirmed the creeper dead, end health **20**, recorded damage 0. The pillar fired. The arrow still did not count as a hit.

Movement did not look mirrored: the lane gap grew after the shot, and the roofed bot went up instead of walking into the creeper. Arrows still do not register hits. No second combat run — the same suite would not add a yaw sample, and two of the three allowed runs are still unused.
