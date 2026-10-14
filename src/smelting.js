// Furnace inputs and their outputs for the connected version (registry names verified by
// tests/howto.test.js). Logs of any species smelt to charcoal; that rule is applied in code.
export const SMELTING={'raw_iron':'iron_ingot','raw_gold':'gold_ingot','raw_copper':'copper_ingot','ancient_debris':'netherite_scrap','sand':'glass','red_sand':'glass','cobblestone':'stone','stone':'smooth_stone','clay_ball':'brick','clay':'terracotta','beef':'cooked_beef','porkchop':'cooked_porkchop','chicken':'cooked_chicken','mutton':'cooked_mutton','rabbit':'cooked_rabbit','cod':'cooked_cod','salmon':'cooked_salmon','potato':'baked_potato','kelp':'dried_kelp','cactus':'green_dye','sea_pickle':'lime_dye','chorus_fruit':'popped_chorus_fruit','netherrack':'nether_brick','wet_sponge':'sponge','quartz_block':'smooth_quartz','deepslate_bricks':'cracked_deepslate_bricks','polished_blackstone_bricks':'cracked_polished_blackstone_bricks','stone_bricks':'cracked_stone_bricks'};
export function smeltingOutput(name){
 return SMELTING[name]||(name.endsWith('_log')?'charcoal':null);
}
