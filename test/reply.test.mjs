import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startAgent,messageAgent} from '../src/agent.mjs';
test('reply requires exact ingestion, rejects unrelated turns, and retries never resubmit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-reply-'));const sent=[];
 const a=await startAgent(dir,{},s=>sent.push(s));const instance=a.path.split('/').pop().slice(0,-5);
 const reply={role:'assistant',stopReason:'stop',content:[{type:'thinking',thinking:'private'},{type:'text',text:'answer'}]};
 try{
 await messageAgent(dir,instance,'one','question');a.observeTurn(reply);
 assert.equal((await messageAgent(dir,instance,'one','question')).response,undefined);
 a.observeMessage({role:'user',content:sent[0]});a.observeTurn(reply,[{role:'user',content:sent[0]}]);
 assert.equal((await messageAgent(dir,instance,'one','question')).response.text,'answer');assert.equal(sent.length,1);
 await assert.rejects(()=>messageAgent(dir,instance,'one','different'));
 await messageAgent(dir,instance,'two','next');a.observeMessage({role:'user',content:sent[1]});a.observeMessage({role:'user',content:'unrelated'});a.observeTurn(reply);
 assert.equal((await messageAgent(dir,instance,'two','next')).response,undefined);
 }finally{await a.close();await rm(dir,{recursive:true,force:true});}
});
import {waitForReply} from '../src/wait.mjs';
test('bounded wait returns timeout, completed response, and aborts without more polls',async()=>{
 let reads=0;assert.equal((await waitForReply(async()=>{reads++;return {receipt:'submitted_unconfirmed'};},undefined,5)).wait,'timed_out');assert.ok(reads>=1);
 assert.equal((await waitForReply(async()=>({response:{text:'reply'}}),undefined,5)).wait,'reply');
 const c=new AbortController();c.abort();await assert.rejects(()=>waitForReply(async()=>({}),c.signal,10));
});
test('navigation and errors invalidate attribution; tool content cannot become reply',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-correlation-'));let envelope;
 const a=await startAgent(dir,{},s=>envelope=s);const instance=a.path.split('/').pop().slice(0,-5);
 try{
 for(const [id,reset] of [['navigation',true],['error',false]]){
 await messageAgent(dir,instance,id,'question');a.observeMessage({role:'user',content:[{type:'text',text:envelope}]});
 if(reset)a.resetCorrelation();else a.observeTurn({role:'assistant',stopReason:'error',content:[{type:'text',text:'failed'}]});
 a.observeTurn({role:'assistant',stopReason:'stop',content:[{type:'text',text:'unrelated'}]});
 assert.equal((await messageAgent(dir,instance,id,'question')).response,undefined);
 }
 }finally{await a.close();await rm(dir,{recursive:true,force:true});}
});
test('concurrent phone instructions are never cross-attributed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-concurrent-'));const sent=[];const a=await startAgent(dir,{},s=>sent.push(s));const instance=a.path.split('/').pop().slice(0,-5);
 try{
 await Promise.all([messageAgent(dir,instance,'a','first'),messageAgent(dir,instance,'b','second')]);
 a.observeMessage({role:'user',content:sent[0]});a.observeMessage({role:'user',content:sent[1]});a.observeTurn({role:'assistant',stopReason:'stop',content:[{type:'text',text:'answer'}]});
 // Combined user inputs are ambiguous: neither should claim this answer.
 assert.equal((await messageAgent(dir,instance,'a','first')).response,undefined);
 assert.equal((await messageAgent(dir,instance,'b','second')).response,undefined);
 }finally{await a.close();await rm(dir,{recursive:true,force:true});}
});
test('extension lifecycle correlates completed user events to final visible turns',async()=>{
 const {default:voice}=await import('../extensions/voice.mjs');const dir=await mkdtemp(join(tmpdir(),'voice-events-'));const prior=process.env.PI_VOICE_IPC_DIR;process.env.PI_VOICE_IPC_DIR=dir;
 const events={};const sent=[];voice({on:(n,h)=>events[n]=h,registerCommand:()=>{},getSessionName:()=> 'test',sendUserMessage:s=>sent.push(s)});
 try{
 await events.session_start({}, {sessionManager:{getSessionId:()=> 'test',getBranch:()=>[]}});
 const {listAgents}=await import('../src/agent.mjs');const [a]=await listAgents(dir);
 await messageAgent(dir,a.instance,'events','question');events.message_end({message:{role:'user',content:sent[0]}});
 events.turn_end({context:{contextMessages:[{role:'user',content:sent[0]}]},message:{role:'assistant',stopReason:'toolUse',content:[{type:'text',text:'working'},{type:'toolCall',name:'bash',arguments:{secret:'private'}}]}});
 assert.equal((await messageAgent(dir,a.instance,'events','question')).response,undefined);
 events.turn_end({context:{contextMessages:[{role:'user',content:sent[0]}]},message:{role:'assistant',stopReason:'stop',content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'x'.repeat(1000)}]}});
 const result=await messageAgent(dir,a.instance,'events','question');assert.equal(result.response.text.length,800);assert.equal(result.response.truncated,true);
 }finally{await events.session_shutdown();if(prior===undefined)delete process.env.PI_VOICE_IPC_DIR;else process.env.PI_VOICE_IPC_DIR=prior;await rm(dir,{recursive:true,force:true});}
});
test('disconnect cancels pending polling timer without extra reads',async()=>{
 const c=new AbortController();let reads=0;
 const pending=waitForReply(async()=>{reads++;return {};},c.signal,8000);
 const timer=setTimeout(()=>c.abort(),5);
 try{await assert.rejects(()=>pending,{name:'AbortError'});assert.equal(reads,1);}finally{clearTimeout(timer);}
});
test('Pi shutdown terminates a waiting request instead of hanging',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-shutdown-'));const a=await startAgent(dir,{},()=>{});const instance=a.path.split('/').pop().slice(0,-5);
 let reads=0;
 try{await assert.rejects(()=>waitForReply(async()=>{const value=await messageAgent(dir,instance,'shutdown','question');if(++reads===1)await a.close();return value;},undefined,1000));assert.equal(reads,1);}
 finally{await a.close();await rm(dir,{recursive:true,force:true});}
});
