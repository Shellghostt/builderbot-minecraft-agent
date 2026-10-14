import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Worker} from './worker.js';
import {jobSchema} from './schema.js';
import {howto} from './howto.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
const worker=new Worker(root,config);worker.on('event',message=>console.log(new Date().toISOString(),message));
const token=crypto.randomBytes(32).toString('hex');fs.writeFileSync(path.join(root,'data/dashboard-token'),token);
const html=fs.readFileSync(path.join(root,'src/dashboard.html'));
function send(res,code,data){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw Error('Request too large');}return text?JSON.parse(text):{};}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const host=req.headers.host;if(![`127.0.0.1:${config.dashboardPort}`,`localhost:${config.dashboardPort}`].includes(host))return send(res,403,{error:'Local access only'});
 const url=new URL(req.url,`http://${host}`);
 if(req.method==='GET'&&url.pathname==='/'){
  if(url.searchParams.get('token')===token){res.writeHead(303,{'Set-Cookie':`agent=${token}; HttpOnly; SameSite=Strict; Path=/`,'Location':'/'});return res.end();}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; connect-src 'self'"});return res.end(html);
 }
 const authorized=req.headers.authorization===`Bearer ${token}`||(req.headers.cookie||'').split(';').some(c=>c.trim()===`agent=${token}`);
 if(!authorized)return send(res,401,{error:'Open the control page using Start-Agent.ps1 to sign in'});
 if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`http://${host}`)return send(res,403,{error:'Wrong origin'});
 if(req.method!=='GET'&&!String(req.headers['content-type']).startsWith('application/json'))return send(res,415,{error:'JSON required'});
 try{
  if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,worker.state());
  if(req.method==='GET'&&url.pathname==='/api/autopilot')return send(res,200,worker.autopilot.status());
  if(req.method==='GET'&&url.pathname==='/api/observe')return send(res,200,worker.observe());
  if(req.method==='GET'&&url.pathname==='/api/howto'){
   const item=url.searchParams.get('item')||'';
   if(!/^[a-z0-9_]{1,64}$/.test(item))return send(res,400,{error:'Pass ?item= as a minecraft item name'});
   if(!worker.ready||!worker.bot)return send(res,503,{error:'Connect the bot first; the guide is version-specific'});
   const count=Number(url.searchParams.get('count'))||1;
   return send(res,200,howto(worker.bot,item,count,worker.bot.inventory.items().reduce((map,i)=>(map[i.name]=(map[i.name]||0)+i.count,map),{})));
  }
  if(req.method==='GET'&&url.pathname==='/api/blueprints')return send(res,200,fs.readdirSync(path.join(root,'blueprints')).filter(n=>n.endsWith('.json')).map(n=>n.slice(0,-5)));
  if(req.method!=='POST')return send(res,404,{error:'Not found'});
  const data=await body(req);
  if(url.pathname==='/api/connect'){worker.connect();return send(res,200,{ok:true});}
  if(url.pathname==='/api/disconnect'){worker.disconnect();return send(res,200,{ok:true});}
  if(url.pathname==='/api/stop'){worker.stop('Stopped by user','user');worker.autopilot.stop();return send(res,200,{ok:true});}
  if(url.pathname==='/api/jobs')return send(res,201,worker.submit(data));
  if(url.pathname==='/api/resume')return send(res,200,worker.resume(data.id));
  if(url.pathname==='/api/cancel'){worker.cancel(data.id,'user');return send(res,200,{ok:true});}
  if(url.pathname==='/api/reflexes'){if(typeof data.enabled!=='boolean')throw Error('enabled must be a boolean');worker.setReflexes(data.enabled);return send(res,200,{reflexes:worker.reflexEnabled});}
  if(url.pathname==='/api/autopilot'){if(typeof data.enabled!=='boolean')throw Error('enabled must be a boolean');if(data.enabled)worker.autopilot.start(typeof data.goal==='string'?data.goal:null);else worker.autopilot.stop();return send(res,200,worker.autopilot.status());}
  if(url.pathname==='/api/plan'){
   if(typeof data.request!=='string'||data.request.length>4000)throw Error('Enter a request under 4000 characters');
   const context=worker.state();
   const prompt=`You plan Minecraft tasks. Return ONLY JSON {"explanation":"brief explanation","jobs":[...]}. Allowed jobs: {"type":"gather","block":"oak_log","count":8} with optional "radius":1-64, "searchIfMissing":true, "targetY":-58 and "strip":true for deep mining; {"type":"craft","item":"oak_planks","count":32}; {"type":"goto","position":{"x":0,"y":-60,"z":0}}; {"type":"deposit","position":{"x":0,"y":-60,"z":0},"item":"oak_log"}; {"type":"build","blueprint":"platform","origin":{"x":0,"y":-60,"z":0}}; {"type":"explore","direction":"north","distance":32} (direction north|south|east|west|random, distance 16-256); {"type":"place","block":"cobblestone","position":{"x":0,"y":-60,"z":0}}; {"type":"eat"}; {"type":"equip"}; {"type":"collect","radius":16}; {"type":"smelt","item":"raw_iron","count":3} with optional "fuel":"coal"; {"type":"sleep"}; {"type":"fight","maxSeconds":30} with optional "entity":"zombie"; {"type":"shelter"}; {"type":"obtain","item":"stone_bricks","count":4} with optional "deposit" position - gets any item via its full chain; {"type":"use","item":"iron_axe","position":{"x":0,"y":-60,"z":0}} to strip logs, till with a hoe, bone-meal crops, fill/empty a water bucket (or "entity":"sheep"); {"type":"shear"} with shears in the inventory; {"type":"breed","entity":"cow"} with 2 wheat; {"type":"hunt","entity":"cow","count":2} for leather or food. Counts 1-128 (obtain up to 1024), smelt 1-48, explore distance 16-256. Gather mines only named blocks within its radius (default 32); with searchIfMissing it explores and can staircase down to targetY for underground blocks. Explore digs only natural blocks and never breaks player-made blocks. No arbitrary code. If a required chest coordinate or building origin is missing, return jobs [] and ask for it in explanation. Never invent coordinates or resources. Craft count means desired additional output. Existing blueprints: ${fs.readdirSync(path.join(root,'blueprints')).join(',')}. Current state: ${JSON.stringify({position:context.position,inventory:context.inventory})}. /no_think`;
   const modelKey=fs.readFileSync(path.join(root,'data/model-token'),'utf8');
   const response=await fetch(config.model.url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+modelKey},body:JSON.stringify({model:config.model.name,messages:[{role:'system',content:prompt},{role:'user',content:data.request}],temperature:0.1,max_tokens:1200,response_format:{type:'json_object'},chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(90000)});
   if(!response.ok)throw Error('Local model returned '+response.status);const output=await response.json();let answer=output.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g,'').trim();const planned=JSON.parse(answer);
   if(!Array.isArray(planned.jobs)||planned.jobs.length>12||typeof planned.explanation!=='string')throw Error('Model returned an invalid plan');planned.jobs=planned.jobs.map(j=>jobSchema.parse(j));return send(res,200,planned);
  }
  return send(res,404,{error:'Not found'});
 }catch(e){send(res,400,{error:e.message});}
});
server.listen(config.dashboardPort,'127.0.0.1',()=>console.log(`Dashboard ready at http://127.0.0.1:${config.dashboardPort}`));
function shutdown(){worker.disconnect();server.close();setTimeout(()=>process.exit(),1500).unref();}
// A plugin throw inside a physics timer must never kill the whole dashboard (a crashed
// process drops the bot, the dashboard and every job): log it and keep serving. The
// bot-specific state is torn down on 'end' by the worker; the worst case is a stale bot
// that reconnects.
process.on('uncaughtException',err=>{
 const stamp=new Date().toISOString();
 try{fs.appendFileSync(path.join(root,'logs/dashboard-uncaught.log'),stamp+' '+err.stack+'\n');}catch{}
 try{if(worker&&worker.log)worker.log('Recovered from an internal error: '+err.message);}catch{}
 try{if(worker&&worker.bot){try{worker.bot.pathfinder&&worker.bot.pathfinder.stop();}catch{}try{worker.bot.pathfinder&&worker.bot.pathfinder.setGoal(null);}catch{}}}catch{}
});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
