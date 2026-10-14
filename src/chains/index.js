// Chains for the AltoClef port (docs/ALTOCLEF_PORT_SPEC.md item 2) and the default stack
// the main wiring can hand to TaskRunner. Priority bands (from the Java sources):
//   100 lava/fire escape, MLG fall, respawn
//   90  self-extinguish with water
//   85  cornered last-resort fight (7f)
//   80  run from hostiles we cannot deal with
//   75  get-armed crafting (7f)
//   70  universally dangerous / vulnerable mobs
//   65  fight annoying hostiles / dodge projectiles / keep distance from burning undead
//   60  recover after an encounter (7f: return at health >= 14), water pickup, portal shimmy
//   55  food collection, dusk shelter preparation (7f)
//   50  user task
//   -1  inactive
// Every chain is ported from adris/altoclef chains/*.java
// (https://github.com/gaucho-matrero/altoclef, commit af22e3bc2f03dde45da703f5f7535baae18ea486),
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
export {SingleTaskChain} from './singleTaskChain.js';
export {MobDefenseChain} from './mobDefenseChain.js';
export {FoodChain} from './foodChain.js';
export {WorldSurvivalChain} from './worldSurvivalChain.js';
export {MLGBucketFallChain} from './mlgBucketFallChain.js';
export {UserTaskChain} from './userTaskChain.js';
export {RespawnChain} from './respawnChain.js';
export * from './combatPolicy.js';
export * from './fallbackTasks.js';
import {MobDefenseChain} from './mobDefenseChain.js';
import {FoodChain} from './foodChain.js';
import {WorldSurvivalChain} from './worldSurvivalChain.js';
import {MLGBucketFallChain} from './mlgBucketFallChain.js';
import {UserTaskChain} from './userTaskChain.js';
import {RespawnChain} from './respawnChain.js';
// Default stack, ordered like AltoClef's registration (max priority wins anyway).
// Sibling references: FoodChain/MobDefenseChain ask each other and the MLG chain about
// eating-critical/acrobatics/falling, exactly like mod.getFoodChain() etc. in Java.
export const defaultChains=({userTaskOpts={},respawnOpts={}}={})=>{
 const mlg=new MLGBucketFallChain();
 const food=new FoodChain({mlg});
 const mobDefense=new MobDefenseChain({food,mlg});
 food.mobDefense=mobDefense;
 return [
  new RespawnChain(respawnOpts),
  new WorldSurvivalChain(),
  mlg,
  mobDefense,
  food,
  new UserTaskChain(userTaskOpts)];
};
