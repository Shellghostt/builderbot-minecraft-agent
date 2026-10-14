// Time of day in ticks 0..23999, or null before the first time packet. mineflayer 4.39 already
// reduces update_time modulo 24000, but GLM saw raw world-age values on the ViaVersion path and
// a stopped daylight cycle can arrive negative: every clock check normalises through here.
export const dayTicks=bot=>{
 const t=bot&&bot.time&&bot.time.timeOfDay;
 return typeof t==='number'&&Number.isFinite(t)?(t%24000+24000)%24000:null;
};
export const NIGHT_START=12541,NIGHT_END=23458; // beds work in this window
export const isNight=bot=>{const t=dayTicks(bot);return t!=null&&t>=NIGHT_START&&t<=NIGHT_END;};
