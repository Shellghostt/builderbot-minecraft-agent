# Cloud session round 4 (code only) - Claude, 2026-10-14 23:45

Same rules as `docs/CLOUD_TASK.md`. Read Cursor's newest sections in `docs/TEST_REPORTS.md` (integration, combat and the 21:46-23:36 dual soak on your round-3 code `d4e3aac`) first.

## What the live tests showed on round 3
- Wins: roofed creeper pillared, 2/2 arrows landed, 0 damage. Integration green incl. A4. **First iron pickaxe** (normal1, t=812).
- Regressions: 3-4 deaths (0 the round before), a packet kick, hard stone still 0/2 pickaxes.

## Tasks, in order (fix root causes; unit-test each)
1. **Suffocation during dig-down** (2 deaths: hard1 [149,129,36], hard2 [140,129,34], "suffocated in a wall"), both right after `Autopilot stopped (Stop all)`. Find how the bot ends up with its head in a block: a cancel/stop mid-staircase step (controls cleared while half-way into a 1-high cell?), falling gravel/sand above the tunnel, or the climb-back. The staircase must never leave the bot in a cell without 2-high air; on any stop/cancel it must finish or undo the current step and climb out; check falling blocks above every dug cell.
2. **`Autopilot stopped (Stop all)` still fires on its own** (normal2 twice, hard1, hard2), despite round 2's `cancel(id, source)` fix. Find every remaining caller that reaches the user-stop path (watchdog, job timeout, reflex/chain pauses, gather/dig-down cancels) and make only a real user/API stop set `userStopped`. Add a test per caller.
3. **Packet kick** `You are sending too many packets!` at 17:58Z (during hard2's dig-down/suffocation). Find the flood (dig retries, look spam while stuck in a wall, swing/arm-animation, use-item) and enforce a global outgoing-packet budget in `src/compat.js` (all serverbound play packets, not only movement), with a unit test.
4. **Hard stone step: cobble but no stone pickaxe.** hard1 had cobble at 150 s and hard2 at 241 s, yet neither crafted a stone pickaxe or furnace. Find why the craft never happened (table out of reach / collected, sticks missing, the ladder stuck on gather, dig-down loop) and fix it.
5. **Skeleton death in a cave** (normal3, [355,41,81], `shot by Skeleton`, during the food explore at y=41). The food explore should not descend into caves (it is a surface activity: cap at the anchor's surface minus a few blocks), and when shot at with no shield, break line of sight or pillar instead of continuing the explore.
6. **Small ones:** the tunnel refused `snow_block` ("needs a suitable tool") - snow blocks are hand/shovel-mineable; and at the end of the iron step, collect the furnace output before moving on (normal1 ended with 30 raw iron in the furnace and 0 ingots held).

Finish with a "Cloud session round 4" section appended to `docs/HANDOVER_FROM_GLM.md`.
