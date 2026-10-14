import test from 'node:test';
import assert from 'node:assert/strict';
import {creeperSwell} from '../src/creeper.js';
test('swell_dir 1 is fusing and a powered creeper doubles the keep-out',()=>{
 assert.deepEqual(creeperSwell({metadata:{16:-1,17:false,18:false}}).fusing,false);
 const live=creeperSwell({metadata:{16:1,17:false,18:false}});
 assert.equal(live.fusing,true);assert.equal(live.keep,7);assert.equal(live.swell,1);
 const charged=creeperSwell({metadata:{16:1,17:true,18:false}});
 assert.equal(charged.powered,true);assert.equal(charged.keep,14);
 assert.equal(creeperSwell({metadata:{16:-1,17:false,18:true}}).fusing,true);
 assert.equal(creeperSwell({}).known,false);
});
