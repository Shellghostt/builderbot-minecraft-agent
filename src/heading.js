// mineflayer's look convention (node_modules/mineflayer/lib/plugins/physics.js bot.lookAt and
// ray_trace.js getViewDirection): view = (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch)).
// Yaw 0 faces -z (north), +PI/2 faces -x, and positive pitch looks UP; compat.js sends the
// same thing to the server (yRot=180-yaw, xRot=-pitch). The Notchian convention (z=+cos(yaw),
// positive pitch down) is NOT what bot.look() takes: combat and the fallback tasks used it,
// which mirrored every heading along z and every bow pitch (cloud session 2026-10-14).
export const yawToward=(dx,dz)=>Math.atan2(-dx,-dz);
export const pitchToward=(dy,ground)=>Math.atan2(dy,ground);
export const headingOf=yaw=>({x:-Math.sin(yaw),z:-Math.cos(yaw)});
