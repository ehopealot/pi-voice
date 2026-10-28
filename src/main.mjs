import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {Bridge,deny} from './bridge.mjs';import {server} from './http.mjs';import {listAgents,messageAgent} from './agent.mjs';
import {waitForReply} from './wait.mjs';
export function validateConfig(c){if(!c||!/^\+\d{8,15}$/.test(c.owner)||!/^\+\d{8,15}$/.test(c.number)||!/^AC[\da-f]{32}$/i.test(c.account)||!/^SK[\da-f]{32}$/i.test(c.twilioKey)||typeof c.agent!=='string'||!c.agent||typeof c.ipcDir!=='string'||!c.ipcDir.startsWith('/')||typeof c.initSecret!=='string'||c.initSecret.length<32||typeof c.twilioSecret!=='string'||c.twilioSecret.length<20||typeof c.passphrase!=='string'||c.passphrase.length<12||c.passphrase.length>256)throw Error('Invalid configuration');return c;}
export function twilioLookup(c){return async sid=>{const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.account}/Calls/${sid}.json`,{headers:{authorization:'Basic '+Buffer.from(c.twilioKey+':'+c.twilioSecret).toString('base64')},signal:AbortSignal.timeout(4000),redirect:'error'});if(!r.ok)deny();return r.json();};}
export function createApp(config,lookup=twilioLookup(config)){
validateConfig(config);const bridge=new Bridge(config,lookup);
return server(async(path,headers,data,signal)=>{
if(path==='/initiate'){const token=await bridge.initiate(headers['x-init-secret'],data);return {type:'conversation_initiation_client_data',dynamic_variables:{secret__pi_voice:token}};}
const token=headers['x-pi-voice'];
if(path==='/verify')return bridge.verify(token,data.passphrase);
await bridge.authorize(token);
if(path==='/list')return {workstreams:await listAgents(config.ipcDir)};
if(path==='/status'){const agents=await listAgents(config.ipcDir);const a=agents.find(x=>x.instance===data.instance);if(!a)deny();return a;}
if(path==='/message'){
const result=await waitForReply(()=>messageAgent(config.ipcDir,data.instance,data.id,data.text),signal);
await bridge.authorize(token);
signal?.throwIfAborted();
return result;
}
deny();});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
try{const c=JSON.parse(await readFile(process.argv[2]||'config.json','utf8'));const app=createApp(c);app.listen(4123,'127.0.0.1',()=>console.log('Pi voice listening on 127.0.0.1:4123'));app.on('error',()=>{console.error('Bridge startup failed');process.exitCode=1;});}catch{console.error('Bridge configuration failed');process.exitCode=1;}
}
