import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const client=new Client({name:'setup-check',version:'1.0.0'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp.js')]}));
 const listing=await client.listTools();assert.equal(listing.tools.length,12);
 const result=await client.callTool({name:'minecraft_status',arguments:{}});assert.equal(result.isError,false);const state=JSON.parse(result.content[0].text);assert.ok(Array.isArray(state.jobs));
 const observed=await client.callTool({name:'minecraft_observe',arguments:{}});assert.equal(observed.isError,false);const summary=JSON.parse(observed.content[0].text);
 assert.ok('connected' in summary);if(summary.connected)assert.ok(summary.blocks&&summary.entities&&summary.inventory,'observe is missing perception data');
 const guide=await client.callTool({name:'minecraft_howto',arguments:{item:'lantern',count:1}});assert.equal(guide.isError,false);
 const parsed=JSON.parse(guide.content[0].text);
 if(parsed.status)assert.ok(['obtainable','already satisfied','unobtainable'].includes(parsed.status));
 const toggled=await client.callTool({name:'minecraft_reflexes',arguments:{enabled:true}});assert.equal(toggled.isError,false);
 const ap=await client.callTool({name:'minecraft_autopilot_start',arguments:{}});assert.equal(ap.isError,false);
 const apStop=await client.callTool({name:'minecraft_autopilot_stop',arguments:{}});assert.equal(apStop.isError,false);
 console.log('PASS: MCP handshake, twelve tools, live status, observe, howto, reflexes and autopilot toggles');
}finally{await client.close();}
