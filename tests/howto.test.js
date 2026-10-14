import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import {howto} from '../src/howto.js';
import {SMELTING,smeltingOutput} from '../src/smelting.js';
const bot={version:'1.21.4'};
test('every smelting key and output exists in the connected registry',()=>{
 const mc=minecraftData('1.21.4');
 for(const [input,output] of Object.entries(SMELTING)){
  assert.ok(mc.itemsByName[input],'smelt input '+input);
  assert.ok(mc.itemsByName[output],'smelt output '+output);
 }
 for(const species of Object.keys(mc.itemsByName).filter(n=>n.endsWith('_log')))assert.equal(smeltingOutput(species),'charcoal');
 assert.equal(smeltingOutput('beef'),'cooked_beef');
 assert.equal(smeltingOutput('diamond'),null);
});
test('stone bricks chain from cobblestone through smelting',()=>{
 const guide=howto(bot,'stone_bricks',4,{});
 assert.equal(guide.status,'obtainable');
 const smelt=guide.steps.find(s=>s.op==='smelt');
 assert.ok(smelt,'expected a smelt step');
 assert.equal(smelt.item,'cobblestone');
 assert.ok(guide.steps.some(s=>s.op==='craft'&&s.item==='stone_bricks'));
});
test('with cobblestone already held the chain skips gathering and tool making',()=>{
 const guide=howto(bot,'stone_bricks',4,{cobblestone:16,coal:1});
 assert.equal(guide.status,'obtainable');
 assert.equal(guide.steps.some(s=>s.op==='gather'),false);
 assert.equal(guide.steps.some(s=>s.item==='wooden_pickaxe'),false);
});
test('iron ingots point at iron ore with a stone pickaxe, not generated iron blocks',()=>{
 const guide=howto(bot,'iron_ingot',3,{});
 assert.equal(guide.status,'obtainable');
 const ore=guide.steps.find(s=>s.op==='gather'&&s.block==='iron_ore');
 assert.ok(ore,'expected an iron ore gather');
 assert.ok(guide.steps.some(s=>s.item==='stone_pickaxe'&&(s.op==='craft'||s.block==='stone_pickaxe')));
 assert.equal(guide.steps.some(s=>s.block==='iron_block'),false);
});
test('diamonds point at diamond ore near y=-58',()=>{
 const guide=howto(bot,'diamond',3,{});
 const ore=guide.steps.find(s=>s.op==='gather'&&s.block==='diamond_ore');
 assert.ok(ore,'expected a diamond ore gather');
 assert.equal(ore.targetY,-58);
});
test('glass panes smelt sand, and large counts are batched',()=>{
 const pane=howto(bot,'glass_pane',16,{sand:6,coal:1});
 assert.equal(pane.status,'obtainable');
 assert.equal(pane.steps.some(s=>s.op==='gather'),false);
 const guide=howto(bot,'oak_log',600,{});
 const gather=guide.steps.find(s=>s.op==='gather');
 assert.equal(gather.batches,5);
});
test('unsupported items name the blocking leaf and the reason',()=>{
 const end=howto(bot,'elytra',1,{});
 assert.equal(end.status,'unobtainable');
 assert.ok(end.reason.includes('End'),end.reason);
 const water=howto(bot,'water_bucket',1,{});
 assert.equal(water.status,'unobtainable');
 assert.ok(water.reason.includes('water'),water.reason);
 const leaves=howto(bot,'oak_leaves',1,{});
 assert.equal(leaves.status,'unobtainable');
 assert.ok(leaves.reason.includes('shears'),leaves.reason);
});
test('a lantern from an ingot, coal and planks plans nuggets, torch and stick - never digging lanterns',()=>{
 const guide=howto(bot,'lantern',1,{iron_ingot:1,coal:1,oak_planks:4});
 assert.equal(guide.status,'obtainable');
 assert.ok(guide.steps.some(s=>s.item==='iron_nugget'));
 assert.ok(guide.steps.some(s=>s.item==='torch'));
 assert.equal(guide.steps.some(s=>s.block==='lantern'),false);
});
test('items the inventory already covers need no steps',()=>{
 const guide=howto(bot,'dirt',8,{dirt:8});
 assert.equal(guide.status,'already satisfied');
 assert.deepEqual(guide.steps,[]);
});
test('the tree stays within the step limit instead of planning something absurd',()=>{
 const guide=howto(bot,'netherite_ingot',1,{});
 assert.ok(['unobtainable','obtainable'].includes(guide.status));
 if(guide.status==='obtainable')assert.ok(guide.steps.length<=28);
});
