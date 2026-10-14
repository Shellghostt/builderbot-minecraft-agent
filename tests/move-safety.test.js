// Research items 2 and 4. No server, no services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {avoidanceActive,pickOpenStand,onShotLine,stepCost,trackProgress} from '../src/move-safety.js';

const air=(sky)=>({name:'air',boundingBox:'empty',skyLight:sky});
const solid=(name)=>({name,boundingBox:'block',skyLight:0});

test('avoidance is on when unarmed or hurt, off when armed and healthy',()=>{
 assert.equal(avoidanceActive(false,20),true);
 assert.equal(avoidanceActive(true,8),true);
 assert.equal(avoidanceActive(true,20),false);
});

test('pickOpenStand chooses a sky-lit cell beside a log and skips a dark canopy',()=>{
 const world=new Map();
 const put=(x,y,z,b)=>world.set(x+','+y+','+z,b);
 // Log at (0,0,0) under leaves; open stand two east, sky 15.
 put(0,0,0,solid('oak_log'));
 put(1,0,0,air(4));put(1,1,0,air(4));put(1,-1,0,solid('grass_block'));
 put(2,0,0,air(15));put(2,1,0,air(15));put(2,-1,0,solid('grass_block'));
 const at=(x,y,z)=>world.get(x+','+y+','+z)||null;
 const stand=pickOpenStand(at,[{x:0,y:0,z:0}],{x:0,y:0,z:0});
 assert.deepEqual(stand,{x:2,y:0,z:0});
 // Already in the sun: do not walk off.
 assert.equal(pickOpenStand(at,[{x:0,y:0,z:0}],{x:2,y:0,z:0}),null);
 // Canopy only: null, so a gather is not starved.
 put(2,0,0,air(3));
 assert.equal(pickOpenStand(at,[{x:0,y:0,z:0}],{x:0,y:0,z:0}),null);
});

test('step cost grows near a hostile and on a skeleton shot line',()=>{
 const bot={x:0,y:0,z:0};
 const zombie={name:'zombie',position:{x:5,y:0,z:0}};
 const near=stepCost({x:5,z:0},[zombie],bot);
 const far=stepCost({x:0,z:0},[zombie],bot);
 assert.ok(near>far,'standing on the zombie costs more than standing by the bot');
 assert.equal(stepCost({x:0,z:0},[],bot),0);
 const skel={name:'skeleton',position:{x:10,y:0,z:0}};
 const between=stepCost({x:5,z:0},[skel],bot);
 const aside=stepCost({x:5,z:6},[skel],bot);
 assert.ok(onShotLine(5.5,0.5,skel.position,bot));
 assert.ok(between>aside+30,'the shot line is expensive');
});

test('trackProgress flags a silent hang and clears after a real step',()=>{
 const a=new Vec3(0,0,0);
 let t=trackProgress(a,0,null);
 assert.equal(t.stuck,false);
 t=trackProgress(a,5000,t);
 assert.equal(t.stuck,false);
 t=trackProgress(a,12001,t);
 assert.equal(t.stuck,true);
 const moved=trackProgress(new Vec3(1,0,0),13000,t);
 assert.equal(moved.stuck,false);
});
