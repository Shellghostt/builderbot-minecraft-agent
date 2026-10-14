// Multi-mob melee (combat suite test2_zombie_triple: "Health below 8; retreated from zombie").
// The controller strikes the nearest when the charge is full, keeps that charge across target
// switches, and between swings steps so only one mob stays in reach. FightTask sticks to a
// target in reach instead of flipping to whichever zombie is a hair closer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {CombatController} from '../src/combat.js';
import {FightTask} from '../src/chains/fightTask.js';
import {headingOf} from '../src/heading.js';

const at=(x,y,z)=>new Vec3(x,y,z);
const zombie=(id,x,z)=>({id,name:'zombie',type:'hostile',position:at(x,-60,z),velocity:at(0,0,0),height:1.95,isValid:true,onGround:true});
function makeBot(mobs,{blocks={}}={}){
 const calls=[];
 const bot={version:'1.21.4',health:20,food:20,controlState:{},
  entity:{id:1,position:at(0.5,-60,0.5),velocity:at(0,0,0),onGround:true,height:1.8,isValid:true,yaw:0,pitch:0},
  entities:{},registry:{itemsByName:{},blocksByName:{}},
  inventory:{items:()=>[{name:'iron_sword',count:1}],slots:[]},heldItem:{name:'iron_sword'},
  blockAt:p=>blocks[`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`]||null,
  setControlState:(n,v)=>{bot.controlState[n]=v;},
  look:async(yaw,pitch)=>{bot.entity.yaw=yaw;bot.entity.pitch=pitch;},
  attack:e=>{calls.push(['attack',e.id]);},equip:async()=>{},activateItem(){},deactivateItem(){}};
 bot.entities[1]=bot.entity;for(const m of mobs)bot.entities[m.id]=m;
 const move={setControls:s=>{for(const[k,v]of Object.entries(s))bot.setControlState(k,v);},look:(y,p)=>{bot.entity.yaw=y;bot.entity.pitch=p;}};
 return {bot,calls,move};
}
// World direction the look-relative controls walk (prismarine-physics applyHeading).
function walkDir(bot){
 const c=bot.controlState,y=bot.entity.yaw;
 let x=0,z=0;
 const add=(yaw,k)=>{const h=headingOf(yaw);x+=h.x*k;z+=h.z*k;};
 if(c.forward)add(y,1);if(c.back)add(y+Math.PI,1);if(c.left)add(y+Math.PI/2,1);if(c.right)add(y-Math.PI/2,1);
 const n=Math.hypot(x,z);return n?{x:x/n,z:z/n}:{x:0,z:0};
}

test('a target switch keeps the attack charge (no uncharged swing on the new zombie)',()=>{
 let clock=10;
 const a=zombie(2,0.5,-2),b=zombie(3,2.5,0.5);
 const {bot,calls,move}=makeBot([a,b]);
 const c=new CombatController(bot,move,{now:()=>clock});
 c.setTarget(a);c._lastStrike=clock-0.2; // swung 0.2 s ago: a 1.0 s sword is not ready
 c.setTarget(b);c.tick();
 assert.equal(calls.filter(x=>x[0]==='attack').length,0);
 clock+=1.0;c.tick();
 assert.deepEqual(calls.filter(x=>x[0]==='attack'),[['attack',3]],'swings once the charge is back');
});
test('between swings a second zombie in reach makes the bot step away from it, still facing the target',()=>{
 const clock=10;
 const target=zombie(2,0.5,-2.0),flank=zombie(3,-1.5,0.5); // north, and west within reach
 const {bot,calls,move}=makeBot([target,flank]);
 const c=new CombatController(bot,move,{now:()=>clock});
 c.setTarget(target);c._lastStrike=clock-0.3;c.tick();
 assert.equal(c.state,'group-spacing');
 assert.equal(calls.filter(x=>x[0]==='attack').length,0);
 const d=walkDir(bot),me=bot.entity.position;
 assert.ok(d.x||d.z,'it moves');
 assert.ok(d.x*(flank.position.x-me.x)+d.z*(flank.position.z-me.z)<0,'away from the flanking zombie: '+JSON.stringify(d));
 assert.ok(d.x*(target.position.x-me.x)+d.z*(target.position.z-me.z)<=0.5,'never walks into the target');
 assert.ok(Math.abs(bot.entity.yaw-0)<1e-9,'still facing the target (north = yaw 0)');
});
test('with the charge full and the target in reach it strikes even with the group close (force field)',()=>{
 const clock=10;
 const target=zombie(2,0.5,-1.8),flank=zombie(3,-1.5,0.5);
 const {bot,calls,move}=makeBot([target,flank]);
 const c=new CombatController(bot,move,{now:()=>clock});
 c.setTarget(target);c.tick();
 assert.deepEqual(calls.filter(x=>x[0]==='attack'),[['attack',2]]);
});
test('cornered (every spacing heading walled) it holds instead of walking into a wall',()=>{
 const clock=10,blocks={};
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)for(const y of[-60,-59])if(Math.abs(x)>=1||z>=1)blocks[`${x},${y},${z}`]={boundingBox:'block'};
 // a pocket open only to the north, where the target stands
 for(let z=-3;z<=0;z++)for(const y of[-60,-59])delete blocks[`0,${y},${z}`];
 const target=zombie(2,0.5,-2.0),flank=zombie(3,0.5,-3.0);
 const {bot,move}=makeBot([target,flank],{blocks});
 const c=new CombatController(bot,move,{now:()=>clock});
 c.setTarget(target);c._lastStrike=clock-0.3;c.tick();
 const s=bot.controlState;
 assert.ok(!s.back&&!s.left&&!s.right&&!s.forward,JSON.stringify(s));
});
test('simulated trio: spacing keeps a second zombie out of reach far more often than holding ground',()=>{
 const run=groupReach=>{
  let clock=0;
  const mobs=[zombie(2,0.5,-3),zombie(3,-2.5,1.5),zombie(4,3.5,1.5)];
  const {bot,calls,move}=makeBot(mobs);
  const c=new CombatController(bot,move,{now:()=>clock,groupReach});
  let crowded=0;
  for(let i=0;i<200;i++){
   const me=bot.entity.position;
   const list=mobs.slice().sort((a,b)=>a.position.distanceTo(me)-b.position.distanceTo(me));
   if(!c.target||c.target.position.distanceTo(me)>3)c.setTarget(list[0]);
   c.tick();
   const d=walkDir(bot);me.x+=d.x*0.2;me.z+=d.z*0.2; // walking ~4 b/s
   for(const m of mobs){const dx=me.x-m.position.x,dz=me.z-m.position.z,n=Math.hypot(dx,dz);if(n>0.9){m.position.x+=dx/n*0.115;m.position.z+=dz/n*0.115;}}
   if(mobs.filter(m=>m.position.distanceTo(me)<=3).length>=2)crowded++;
   clock+=0.05;
  }
  return {crowded,swings:calls.filter(x=>x[0]==='attack').length};
 };
 const {crowded:hold}=run(0),{crowded:spaced,swings}=run(3.5);
 if(process.env.GROUP_SIM)console.log('crowded ticks',{hold,spaced,swings});
 assert.ok(spaced<hold*0.5,'ticks with 2+ zombies in reach: spaced '+spaced+' vs hold '+hold);
 assert.ok(swings>=6,'spacing still swings on every recharge (10 s, 1 s sword): '+swings);
});
test('FightTask stays on a target in reach instead of flipping to a marginally closer zombie',()=>{
 const a=zombie(2,0.5,-2.6),b=zombie(3,2.8,0.5);
 const {bot,move}=makeBot([a,b]);
 const task=new FightTask({move});
 const ctl=task.ensureController(bot,{move});
 ctl.setTarget(a);
 task.onTick(bot,{move});
 assert.equal(ctl.target,a,'a (2.6, in reach) is kept although b (2.3) is nearer');
 a.position=at(0.5,-60,-4.6); // a walked out of reach, b is clearly closer
 task.onTick(bot,{move});
 assert.equal(ctl.target,b);
 // a creeper always takes the target
 const cr={...zombie(5,0.5,-1.5),name:'creeper'};bot.entities[5]=cr;
 task.onTick(bot,{move});
 assert.equal(ctl.target,cr);
});
