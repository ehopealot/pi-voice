import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../src/bridge.mjs';
const sid='CA'+'a'.repeat(32);
const cfg={initSecret:'i'.repeat(32),owner:'+15550000001',number:'+15550000002',agent:'agent1',account:'AC'+'b'.repeat(32),passphrase:'unique spoken phrase'};
function fixture(){let now=1000; let live=true;const b=new Bridge(cfg,async()=>{if(live==='error')throw Error('private');return {sid,account_sid:cfg.account,from:cfg.owner,to:cfg.number,direction:'inbound',status:live?'in-progress':'completed'};},()=>now);return {b,end:()=>live=false,fail:()=>live='error',expire:()=>now+=900001};}
async function init(b,body={}){return b.initiate(cfg.initSecret,{caller_id:cfg.owner,called_number:cfg.number,agent_id:cfg.agent,call_sid:sid,conversation_id:'conv1',...body});}
test('rejects missing capability and forged initiation',async()=>{const {b}=fixture();await assert.rejects(()=>b.authorize('bad'));await assert.rejects(()=>init(b,{caller_id:'+1999'}));await assert.rejects(()=>b.initiate('bad',{}));});
test('reads need passphrase; replay preserves lockout',async()=>{const {b}=fixture();const token=await init(b);await assert.rejects(()=>b.authorize(token));for(let i=0;i<3;i++)await assert.rejects(()=>b.verify(token,'wrong'));await assert.rejects(()=>init(b));await assert.rejects(()=>b.verify(token,cfg.passphrase));});
test('authorized capability expires and rejects ended calls',async()=>{for(const action of ['end','expire','fail']){const f=fixture();const t=await init(f.b);await f.b.verify(t,cfg.passphrase);await f.b.authorize(t);f[action]();await assert.rejects(()=>f.b.authorize(t));}});
test('passphrase comparison ignores case and punctuation',async()=>{
  for(const phrase of ['UNIQUE SPOKEN PHRASE','Unique Spoken Phrase.','“Unique spoken phrase!”']){
    const {b}=fixture();b.config={...cfg,passphrase:'Unique Spoken Phrase.'};
    const t=await init(b);assert.deepEqual(await b.verify(t,phrase),{verified:true});
  }
  for(const phrase of ['wrong words',' unique spoken phrase',null,123]){
    const {b}=fixture();const t=await init(b);await assert.rejects(()=>b.verify(t,phrase));
  }
});
test('initiation secret remains case sensitive',async()=>{
  const {b}=fixture();await assert.rejects(()=>b.initiate(cfg.initSecret.toUpperCase(),{caller_id:cfg.owner,called_number:cfg.number,agent_id:cfg.agent,call_sid:sid,conversation_id:'conv1'}));
});
test('provider outage denies initiation',async()=>{const f=fixture();f.fail();await assert.rejects(()=>init(f.b));});
test('Twilio metadata mismatch denies even authenticated initiation',async()=>{for(const patch of [{from:'+1999'},{to:'+1999'},{account_sid:'other'},{sid:'CA'+'c'.repeat(32)},{direction:'outbound-api'}]){const b=new Bridge(cfg,async()=>({sid,account_sid:cfg.account,from:cfg.owner,to:cfg.number,status:'in-progress',direction:'inbound',...patch}));await assert.rejects(()=>init(b));}});
test('expired initiation replay cannot mint a fresh lifetime',async()=>{const f=fixture();const t=await init(f.b);f.expire();await assert.rejects(()=>init(f.b));await assert.rejects(()=>f.b.verify(t,cfg.passphrase));});
test('initiation replay preserves token and cannot change call binding',async()=>{const {b}=fixture();const t=await init(b);assert.equal(await init(b),t);await assert.rejects(()=>init(b,{conversation_id:'other'}));});
test('global passphrase failure limit applies across call capabilities',async()=>{const b=new Bridge(cfg,async sid=>({sid,account_sid:cfg.account,from:cfg.owner,to:cfg.number,status:'in-progress',direction:'inbound'}));let latest;for(let n=0;n<4;n++){latest=await init(b,{call_sid:'CA'+String(n).padStart(32,'0'),conversation_id:'conv'+n});for(let k=0;k<(n===3?1:3);k++)await assert.rejects(()=>b.verify(latest,'wrong'));}await assert.rejects(()=>b.verify(latest,cfg.passphrase));});
