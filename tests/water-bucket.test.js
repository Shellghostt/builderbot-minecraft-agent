// Round 10, habit 9: a water bucket after the iron core and the light - crafted from 3 ingots,
// filled at a still source in reach, and kept (the MLG fall chain and the fire douse use it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot,ironRung,plan,TORCHES,WATER_NEAR} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const c=map=>n=>map[n]||0;
const base={iron_pickaxe:1,iron_sword:1,shield:1,stone_sword:1,stick:8,oak_planks:8,crafting_table:1,cobblestone:20,stone_pickaxe:2,torch:TORCHES};
const wood={planksTotal:8,logsTotal:0,heldLog:null};
test('the rung crafts the bucket from 3 ingots, fills it, and digs for it with the armour',()=>{
 assert.deepEqual(ironRung(c({...base,iron_ingot:3}),wood),{type:'craft',item:'bucket',count:1});
 const fill=ironRung(c({...base,bucket:1}),{...wood,waterAt:{x:2,y:63,z:5}});
 assert.deepEqual(fill,{type:'use',item:'bucket',position:{x:2,y:63,z:5}});
 assert.ok(jobSchema.safeParse(fill).success);
 // no water in reach: the empty bucket waits, the armour goes on
 assert.equal(ironRung(c({...base,bucket:1}),wood).block,'iron_ore');
 // the armour dig carries the bucket's 3 ingots: 5 + 8 + 3
 assert.equal(ironRung(c(base),wood).count,6);
 const j=ironRung(c({...base,raw_iron:0,iron_ingot:0}),wood);assert.equal(j.type,'gather');
 // a water bucket held is the bucket: no second one
 assert.equal(ironRung(c({...base,water_bucket:1,iron_ingot:5}),wood).item,'iron_helmet');
});
test('the iron step counts a water bucket as its bucket',()=>{
 const FULL={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,_edible:8,
  iron_pickaxe:1,iron_sword:1,iron_axe:1,shield:1,bow:1,arrow:32,iron_helmet:1,iron_chestplate:1,iron_leggings:1,iron_boots:1,torch:16,coal:16,diamond_pickaxe:1,water_bucket:1,
  _equipped_iron_helmet:1,_equipped_iron_chestplate:1,_equipped_iron_leggings:1,_equipped_iron_boots:1};
 assert.equal(plan(FULL).step,'bed');
});
test('waterSource: a still source with air above, only while an empty bucket is held',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'water-'));
 try{
  const items=[{name:'bucket',count:1}];
  const blocks={'3,63,0':{name:'water',metadata:3},'4,63,0':{name:'water',metadata:0},'4,64,0':{name:'air',boundingBox:'empty'},'3,64,0':{name:'air',boundingBox:'empty'},
   '5,62,0':{name:'water',metadata:0},'5,63,0':{name:'water',metadata:0}};
  const bot={registry:{blocksByName:{water:{id:26}}},inventory:{items:()=>items},
   findBlocks(o){assert.equal(o.maxDistance,WATER_NEAR);return [new Vec3(3,63,0),new Vec3(5,62,0),new Vec3(4,63,0)];},
   blockAt(p){return blocks[p.x+','+p.y+','+p.z]||{name:'stone',boundingBox:'block'};}};
  const ap=new Autopilot({log(){},bot},root);
  assert.deepEqual(ap.waterSource(bot),{x:4,y:63,z:0},'flowing water and a submerged source are skipped');
  items.push({name:'water_bucket',count:1});
  assert.equal(ap.waterSource(bot),null,'already filled');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
