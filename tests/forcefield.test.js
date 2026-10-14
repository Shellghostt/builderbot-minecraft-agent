// Force field (research 3): a hostile already in reach is swung at, but never while
// FightTask owns the duel - two swingers share one attack cooldown and whiff both.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {forceFieldTick} from '../src/forcefield.js';

const at=(x,y,z)=>new Vec3(x,y,z);
function world(task){
 const attacks=[];
 const zombie={id:9,name:'zombie',type:'hostile',position:at(1.2,-60,0),height:1.9,isValid:true};
 const bot={
  entity:{id:1,position:at(0,-60,0),height:1.8},
  entities:{9:zombie},
  heldItem:{name:'iron_sword'},
  inventory:{items:()=>[{name:'iron_sword',count:1}]},
  registry:{itemsByName:{}},
  blockAt:()=>null,
  lookAt:()=>Promise.resolve(),
  attack:e=>{attacks.push(e.id);return Promise.resolve();}
 };
 const worker={ready:true,reflexEnabled:true,eating:false,
  taskRunner:{status:()=>({running:true,chain:'User Tasks',task})}};
 return {bot,worker,attacks};
}
test('force field does not swing while FightTask owns the duel',()=>{
 const {bot,worker,attacks}=world('FightTask');
 forceFieldTick(bot,worker);
 assert.deepEqual(attacks,[],'no second swing beside the controller');
});
test('force field swings a hostile in reach when no fight task is active',()=>{
 const {bot,worker,attacks}=world(null);
 forceFieldTick(bot,worker);
 assert.deepEqual(attacks,[9]);
});
