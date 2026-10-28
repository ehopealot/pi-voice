import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import voice from '../extensions/voice.mjs';import {listAgents,messageAgent} from '../src/agent.mjs';
test('Pi lifecycle starts/stops IPC and always specifies followUp',async()=>{const dir=await mkdtemp(join(tmpdir(),'pve-'));const prior=process.env.PI_VOICE_IPC_DIR;process.env.PI_VOICE_IPC_DIR=dir;const events={};const cmds={};const sends=[];let idle=false;const pi={on:(n,f)=>events[n]=f,registerCommand:(n,c)=>cmds[n]=c,getSessionName:()=> 'project',sendUserMessage:(...a)=>sends.push(a)};voice(pi);try{assert.equal((await listAgents(dir)).length,0);await events.session_start({}, {sessionManager:{getSessionId:()=> 'session',getBranch:()=> []},isIdle:()=>idle});await cmds['voice-progress'].handler('Safe summary');let [a]=await listAgents(dir);assert.equal(a.progress,'Safe summary');await messageAgent(dir,a.instance,'m1','focus');assert.deepEqual(sends[0][1],{deliverAs:'followUp'});idle=true;await messageAgent(dir,a.instance,'m2','next');assert.deepEqual(sends[1][1],{deliverAs:'followUp'});await events.session_shutdown();assert.equal((await listAgents(dir)).length,0);}finally{await events.session_shutdown();if(prior===undefined)delete process.env.PI_VOICE_IPC_DIR;else process.env.PI_VOICE_IPC_DIR=prior;await rm(dir,{recursive:true,force:true});}});

test('automatically publishes bounded active-branch user/assistant excerpts and resets after navigation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pve-'));
  const prior = process.env.PI_VOICE_IPC_DIR;
  process.env.PI_VOICE_IPC_DIR = dir;
  const events = {};
  let branch = [{ type: 'message', message: { role: 'user', content: 'Initial task', timestamp: 1 } }];
  const ctx = { sessionManager: { getSessionId: () => 'session', getBranch: () => branch }, isIdle: () => true };
  voice({ on: (n, f) => events[n] = f, registerCommand: () => {}, getSessionName: () => 'project', sendUserMessage: () => {} });
  try {
    await events.session_start({}, ctx);
    let [a] = await listAgents(dir);
    assert.equal(a.recentMessages[0].text, 'Initial task');
    await events.message_end({ message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'HIDDEN' }, { type: 'text', text: 'Visible reply' },
      { type: 'toolCall', arguments: { secret: 'HIDDEN' } },
    ], timestamp: 2 } });
    await events.message_end({ message: { role: 'toolResult', content: [{ type: 'text', text: 'HIDDEN' }] } });
    [a] = await listAgents(dir);
    assert.deepEqual(a.recentMessages.map(x => x.text), ['Initial task', 'Visible reply']);
    assert.equal(JSON.stringify(a).includes('HIDDEN'), false);
    for (let i = 0; i < 12; i++) await events.message_end({ message: { role: 'user', content: 'x'.repeat(900), timestamp: i + 3 } });
    [a] = await listAgents(dir);
    assert.equal(a.recentMessages.length, 8);
    assert.equal(a.recentMessages[0].text.length, 800);
    branch = [{ type: 'message', message: { role: 'user', content: 'New branch', timestamp: 90 } }];
    await events.session_tree({}, ctx);
    [a] = await listAgents(dir);
    assert.deepEqual(a.recentMessages.map(x => x.text), ['New branch']);
  } finally {
    await events.session_shutdown();
    if (prior === undefined) delete process.env.PI_VOICE_IPC_DIR; else process.env.PI_VOICE_IPC_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
