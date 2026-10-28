import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import voice from '../extensions/voice.mjs';
import {listAgents,messageAgent} from '../src/agent.mjs';
import {waitForReply} from '../src/wait.mjs';
const root=dirname(dirname(dirname(realpathSync(join(dirname(process.execPath),'pi')))));
const {ExtensionRunner}=await import(pathToFileURL(join(root,'dist/core/extensions/runner.js')));
const {SessionManager}=await import(pathToFileURL(join(root,'dist/core/session-manager.js')));
test('installed runner later user replacement cannot complete phone reply',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-final-'));const prior=process.env.PI_VOICE_IPC_DIR;process.env.PI_VOICE_IPC_DIR=dir;
 const handlers=new Map();let sent;let replace=true;
 voice({on:(n,h)=>handlers.set(n,[h]),registerCommand:()=>{},getSessionName:()=> 'test',sendUserMessage:s=>sent=s});
 const ctx={sessionManager:{getSessionId:()=> 'test',getBranch:()=>[]}};
 try{
 await handlers.get('session_start')[0]({},ctx);
 const [a]=await listAgents(dir);await messageAgent(dir,a.instance,'replace','phone question');
 const runner=new ExtensionRunner([
 {path:'voice',handlers},
 {path:'later',handlers:new Map([['message_end',[()=>replace?({message:{role:'user',content:'unrelated instruction'}}):undefined]]])}
 ],{},dir,{},{});
 runner.createContext=()=>ctx;
 const replacement=await runner.emitMessageEnd({type:'message_end',message:{role:'user',content:sent}});
 assert.equal(replacement.content,'unrelated instruction');
 const answer={role:'assistant',stopReason:'stop',content:[{type:'text',text:'unrelated answer'}]};
 const session=SessionManager.inMemory(dir);session.appendMessage(replacement);session.appendMessage(answer);
 const messages=session.buildSessionProjection().messages;
 await runner.emitBoundary({type:'turn_end',message:answer,turnIndex:0,toolResults:[],messageEntryId:'a',toolResultEntryIds:[],outcome:'completed'},()=>({contextEntries:[],contextMessages:messages,llmMessages:[],pendingMessages:[],canContinue:false}));
 assert.equal((await messageAgent(dir,a.instance,'replace','phone question')).response,undefined);
 replace=false;
 for(const intervening of [false,true]){
 const id=intervening?'intervening':'unchanged';await messageAgent(dir,a.instance,id,'next');
 const user={role:'user',content:sent};await runner.emitMessageEnd({type:'message_end',message:user});
 session.appendMessage(user);
 if(intervening)session.appendMessage({role:'user',content:'later instruction'});
 session.appendMessage(answer);
 await runner.emitBoundary({type:'turn_end',message:answer,turnIndex:1,toolResults:[],messageEntryId:'b',toolResultEntryIds:[],outcome:'completed'},()=>({contextEntries:[],contextMessages:session.buildSessionProjection().messages,llmMessages:[],pendingMessages:[],canContinue:false}));
 const result=await messageAgent(dir,a.instance,id,'next');
 if(intervening)assert.equal(result.response,undefined);else assert.equal(result.response.text,'unrelated answer');
 }
 }finally{await handlers.get('session_shutdown')[0]();if(prior===undefined)delete process.env.PI_VOICE_IPC_DIR;else process.env.PI_VOICE_IPC_DIR=prior;await rm(dir,{recursive:true,force:true});}
});
test('wall clock rollback cannot extend reply wait', {timeout:2000},async()=>{
 const original=Date.now;let calls=0;
 const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),500);
 try{
 Date.now=()=>original()-(calls>0?3600000:0);
 const result=await waitForReply(async()=>{calls++;return {};},abort.signal,20);
 assert.equal(result.wait,'timed_out');
 }finally{Date.now=original;clearTimeout(timer);}
});
