// Bow shot detection (src/arrowShots.js) and the release-aim sync (src/compat.js).
// Live combat logged `no arrow entity found near the release` and hits=0 on every run.
// These tests pin the detection: a release is proven by the arrow count or an arrow spawn at
// the eye, a landing by the target's hurt event or health metadata, never by distance polls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {ArrowShots,arrowCount,metaHealth,SHOT_WINDOW} from '../src/arrowShots.js';
import {CombatController} from '../src/combat.js';
import {installMovementFix} from '../src/compat.js';

const at=(x,y,z)=>new Vec3(x,y,z);
function fakeBot({arrows=10,entities=[],emitter=true}={}){
 const bot=emitter?new EventEmitter():{};
 if(emitter)bot._client=new EventEmitter();
 bot.version='1.21.4';bot.health=20;bot.food=20;bot.controlState={};
 bot.entity={id:1,position:at(0,-60,0),velocity:at(0,0,0),eyeHeight:1.62,onGround:true,height:1.8,isValid:true};
 bot.entities={1:bot.entity};
 const inv=[{name:'bow',count:1},{name:'arrow',count:arrows}];
 bot.inventory={items:()=>inv.filter(i=>i.count>0),slots:[]};
 bot.registry={entitiesByName:{creeper:{metadataKeys:['a','b','c','d','e','f','g','h','living_entity_flags','health']},
  arrow:{metadataKeys:['a','b','c','d','e','f','g','h','flags','pierce_level','in_ground']}},itemsByName:{},blocksByName:{}};
 bot.heldItem={name:'bow'};
 bot.blockAt=()=>null;bot.setControlState=(n,v)=>{bot.controlState[n]=v;};
 bot.look=async()=>{};bot.activateItem=()=>{};bot.deactivateItem=()=>{};bot.equip=async()=>{};
 for(const e of entities)bot.entities[e.id]=e;
 return {bot,inv};
}
const creeper=(id=7,pos=at(10,-60,0),health=20)=>({id,name:'creeper',type:'hostile',position:pos,velocity:at(0,0,0),height:1.7,isValid:true,metadata:{9:health}});
const arrow=(id,pos,extra={})=>({id,name:'arrow',type:'projectile',position:pos,velocity:at(3,0,0),isValid:true,metadata:{},...extra});

test('arrowCount and metaHealth read the inventory and the registry health index',()=>{
 const {bot}=fakeBot({arrows:7});
 assert.equal(arrowCount(bot),7);
 assert.equal(metaHealth(bot,creeper(7,at(0,0,0),13.5)),13.5);
 assert.equal(metaHealth(bot,{name:'creeper',metadata:{}}),null);
});

test('release confirmed by the arrow spawn at the eye, landing by the hurt event',()=>{
 const t=creeper(),{bot}=fakeBot({entities:[t]});
 const s=new ArrowShots();
 s.release(bot,t,100);
 // an arrow far away (an old one stuck in the ground) is not ours
 assert.deepEqual(s.onSpawn(arrow(50,at(9,-61,0)),100.05),[]);
 const r=s.onSpawn(arrow(51,at(0.3,-58.4,0)),100.05);
 assert.equal(r[0].type,'released');assert.equal(s.shots[0].arrowId,51);assert.equal(s.shots[0].speed,3);
 // a hurt on a different entity is not this shot
 assert.deepEqual(s.onHurt({id:99},bot.entity,100.1),[]);
 const h=s.onHurt(t,bot.entity,100.15);
 assert.equal(h[0].type,'landed');
 assert.deepEqual(s.stats,{released:1,landed:1,missed:0,unreleased:0});
 // a second hurt for the same shot does not double count
 assert.deepEqual(s.onHurt(t,bot.entity,100.2),[]);
});

test('a skeleton arrow next to the bot is never claimed (spawn objectData is its owner)',()=>{
 const t=creeper(),{bot}=fakeBot({entities:[t]});
 const s=new ArrowShots();
 s.release(bot,t,0);
 s.noteOwner(60,42); // skeleton id 42
 assert.deepEqual(s.onSpawn(arrow(60,at(0.5,-58.5,0)),0.05),[]);
 s.noteOwner(61,1);
 assert.equal(s.onSpawn(arrow(61,at(0.5,-58.5,0)),0.06)[0].type,'released');
 // a hurt credited to another source (the skeleton) is not our landing
 assert.deepEqual(s.onHurt(t,{id:42},0.1),[]);
});

test('release proven by the inventory arrow count; landing by the health metadata',()=>{
 const t=creeper(),{bot,inv}=fakeBot({arrows:5,entities:[t]});
 const s=new ArrowShots();
 s.release(bot,t,10);
 assert.deepEqual(s.poll(bot,10.05),[]);
 inv[1].count=4;
 const r=s.poll(bot,10.1);
 assert.equal(r[0].type,'released');assert.match(r[0].detail,/5->4/);
 t.metadata[9]=14;
 const l=s.poll(bot,10.3);
 assert.equal(l[0].type,'landed');assert.match(l[0].detail,/20->14/);
});

test('a release with no arrow count drop and no spawn is reported as unreleased',()=>{
 const t=creeper(),{bot}=fakeBot({entities:[t]});
 const s=new ArrowShots();
 s.release(bot,t,0);
 assert.deepEqual(s.poll(bot,1),[]);
 const r=s.poll(bot,SHOT_WINDOW+0.1);
 assert.equal(r[0].type,'unreleased');assert.match(r[0].detail,/no arrow left the bow/);
 assert.equal(s.stats.unreleased,1);
});

test('a released arrow that sticks in the ground is a miss; silence past the window too',()=>{
 const t=creeper(),{bot}=fakeBot({entities:[t]});
 const s=new ArrowShots();
 s.release(bot,t,0);
 const a=arrow(70,at(0.4,-58.4,0));bot.entities[70]=a;
 s.onSpawn(a,0.05);
 a.metadata[10]=true;
 assert.equal(s.poll(bot,0.5)[0].type,'missed');
 s.release(bot,t,5);
 s.onSpawn(arrow(71,at(0.4,-58.4,0)),5.05);
 assert.equal(s.poll(bot,5+SHOT_WINDOW+0.1)[0].type,'missed');
 assert.deepEqual(s.stats,{released:2,landed:0,missed:2,unreleased:0});
});

test('controller: a bow release is counted as a hit when the arrow lands (events wired, unhooked on stop)',()=>{
 let clock=0;const t=creeper(),{bot}=fakeBot({entities:[t]});
 const logs=[];
 const c=new CombatController(bot,null,{now:()=>clock,log:m=>logs.push(m)});
 c.setTarget(t);
 c.stats.shots++;c._released(t);
 bot._client.emit('spawn_entity',{entityId:80,objectData:1});
 const a=arrow(80,at(0.3,-58.4,0));bot.entities[80]=a;
 clock=0.05;bot.emit('entitySpawn',a);
 clock=0.15;bot.emit('entityHurt',t,bot.entity);
 assert.equal(c.stats.released,1);assert.equal(c.stats.landed,1);assert.equal(c.stats.hits,1);
 assert.ok(logs.some(l=>/arrow creeper .*landed/.test(l)),logs.join('\n'));
 c.stop();
 assert.equal(bot.listenerCount('entityHurt'),0);assert.equal(bot.listenerCount('entitySpawn'),0);
 assert.equal(bot._client.listenerCount('spawn_entity'),0);
});

test('controller without bot events still detects the landing by polling the health metadata',()=>{
 let clock=0;const t=creeper(),{bot,inv}=fakeBot({entities:[t],emitter:false});
 const c=new CombatController(bot,null,{now:()=>clock});
 c._released(t);
 inv[1].count=9;t.metadata[9]=12;clock=0.3;
 c.tick(); // no target set: the tick still polls the pending shot
 assert.equal(c.stats.released,1);assert.equal(c.stats.landed,1);assert.equal(c.stats.hits,1);
});

// ---- the release aim reaches the server --------------------------------------------------
function compatBot(){
 const b=new EventEmitter(),packets=[];
 b.registry={version:{'>=':()=>true}};
 b.entity={position:{x:1,y:64,z:2},yaw:Math.PI,pitch:0,onGround:true};
 b._client={state:'play',write:(name,data)=>packets.push({name,data})};
 installMovementFix(b);b.emit('login');
 return {b,packets};
}
test('compat: a capped position_look is not lost - the next position carries its rotation',t=>{
 t.mock.timers.enable({apis:['Date'],now:1_000_000});
 const {b,packets}=compatBot();
 for(let i=0;i<30;i++)b._client.write('position',{x:1,y:64,z:2,yaw:0,pitch:0});
 b._client.write('position_look',{x:1,y:64,z:2,yaw:45,pitch:-10}); // over the 30/s cap: dropped
 assert.ok(!packets.some(p=>p.name==='position_look'));
 t.mock.timers.tick(1001);
 b._client.write('position',{x:1.1,y:64,z:2,yaw:45,pitch:-10}); // mineflayer's lastSent object
 const last=packets.filter(p=>p.name!=='tick_end').at(-1);
 assert.equal(last.name,'position_look');assert.equal(last.data.yaw,45);
 // once delivered, plain positions stay plain
 b._client.write('position',{x:1.2,y:64,z:2,yaw:45,pitch:-10});
 assert.equal(packets.filter(p=>p.name!=='tick_end').at(-1).name,'position');
 b.emit('end');
});
test('compat: the bow release re-sends the current aim when the server holds a stale one',()=>{
 const {b,packets}=compatBot();
 b._client.write('look',{yaw:0,pitch:0,onGround:true}); // server at notchian yaw 0
 b.entity.yaw=Math.PI/2;b.entity.pitch=0.2;              // aimed since, look dropped/unsent
 b._client.write('block_dig',{status:5,location:{x:0,y:0,z:0},face:0,sequence:0});
 const i=packets.findIndex(p=>p.name==='block_dig');
 const look=packets.slice(0,i).reverse().find(p=>p.name==='look');
 assert.ok(Math.abs(look.data.yaw-90)<1e-4,'yaw '+look.data.yaw);
 assert.ok(Math.abs(look.data.pitch+0.2*180/Math.PI)<1e-4);
 // the aim is current: no extra look before the next release
 const n=packets.length;
 b._client.write('block_dig',{status:5,location:{x:0,y:0,z:0},face:0,sequence:0});
 assert.deepEqual(packets.slice(n).map(p=>p.name),['block_dig']);
 // other digs (status 0, start digging) never inject a look
 b.entity.yaw=0;b._client.write('block_dig',{status:0,location:{x:0,y:0,z:0},face:1,sequence:3});
 assert.equal(packets.at(-1).name,'block_dig');assert.notEqual(packets.at(-2).name,'look');
 b.emit('end');
});
test('compat: use_item carries its rotation, so no look is injected after it',()=>{
 const {b,packets}=compatBot();
 b.entity.yaw=Math.PI/2;
 const yaw=Math.fround((Math.PI-b.entity.yaw)*(1/(Math.PI/180)));
 b._client.write('use_item',{hand:0,sequence:1,rotation:{x:yaw,y:-0}});
 const n=packets.length;
 b._client.write('block_dig',{status:5,location:{x:0,y:0,z:0},face:0,sequence:0});
 assert.deepEqual(packets.slice(n).map(p=>p.name),['block_dig']);
 b.emit('end');
});
