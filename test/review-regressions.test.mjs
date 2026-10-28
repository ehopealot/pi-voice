import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Bridge } from '../src/bridge.mjs';
import { startAgent, ipc, listAgents, messageAgent } from '../src/agent.mjs';
import voice from '../extensions/voice.mjs';

const root = process.env.PI_CODING_AGENT_ROOT || dirname(dirname(dirname(realpathSync(join(dirname(process.execPath), 'pi')))));
const { AgentSession } = await import(pathToFileURL(join(root, 'dist/core/agent-session.js')));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test('void public API submission never claims ingestion even when async runtime rejects', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pvr-'));
  const settled = deferred();
  let sends = 0;
  const agent = await startAgent(dir, { id: 'test', name: 'test' }, () => {
    sends++;
    // Faithful public wrapper: returns void; async errors go to runtime diagnostics.
    Promise.reject(Error('input handler failed')).catch(() => settled.resolve());
  });
  try {
    const message = { op: 'message', id: 'once', text: 'Work instruction' };
    const receipt = await ipc(agent.path, message);
    await settled.promise;
    assert.deepEqual(receipt, { id: 'once', receipt: 'submitted_unconfirmed', acted: false });
    assert.deepEqual(await ipc(agent.path, message), receipt);
    assert.equal(sends, 1);
  } finally { await agent.close(); await rm(dir, { recursive: true, force: true }); }
});

test('idle-to-busy input-hook race queues follow-up using installed AgentSession prompt', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pvr-'));
  const previous = process.env.PI_VOICE_IPC_DIR;
  process.env.PI_VOICE_IPC_DIR = dir;
  const entered = deferred();
  const release = deferred();
  const finished = deferred();
  let busy = false;
  const queued = [];
  const errors = [];
  const session = {
    get isStreaming() { return busy; },
    _runInputHandlers: async text => { entered.resolve(); await release.promise; return { text }; },
    _queueFollowUp: async text => queued.push(text),
    _queueSteer: async () => assert.fail('Must not steer'),
    prompt: AgentSession.prototype.prompt,
  };
  const events = {};
  const pi = {
    on: (name, fn) => events[name] = fn,
    registerCommand: () => {}, getSessionName: () => 'race test',
    // Installed runtime binding uses this same void/.catch boundary.
    sendUserMessage: (text, options) => {
      AgentSession.prototype.sendUserMessage.call(session, text, options)
        .catch(e => errors.push(e.message)).finally(() => finished.resolve());
    },
  };
  voice(pi);
  try {
    await events.session_start({}, { isIdle: () => !busy,
      sessionManager: { getSessionId: () => 'race', getBranch: () => [] } });
    const [agent] = await listAgents(dir);
    await messageAgent(dir, agent.instance, 'race', 'Focus on tests');
    await entered.promise;
    busy = true;
    release.resolve();
    await finished.promise;
    assert.deepEqual(errors, []);
    assert.equal(queued.length, 1);
    assert.match(queued[0], /Focus on tests/);
  } finally {
    release.resolve();
    await events.session_shutdown();
    if (previous === undefined) delete process.env.PI_VOICE_IPC_DIR;
    else process.env.PI_VOICE_IPC_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrent deferred lookups cannot exceed 100 call records', { timeout: 5000 }, async () => {
  const config = { initSecret: 'i'.repeat(32), owner: '+15550000001', number: '+15550000002', agent: 'agent', account: 'AC' + 'b'.repeat(32) };
  const pending = [];
  let hold = false;
  const bridge = new Bridge(config, async sid => {
    if (hold) { const d = deferred(); pending.push(d); await d.promise; }
    return { sid, from: config.owner, to: config.number, account_sid: config.account, direction: 'inbound', status: 'in-progress' };
  });
  const initiate = n => bridge.initiate(config.initSecret, {
    caller_id: config.owner, called_number: config.number, agent_id: config.agent,
    call_sid: 'CA' + n.toString(16).padStart(32, '0'), conversation_id: 'conversation-' + n,
  });
  for (let i = 0; i < 99; i++) await initiate(i);
  hold = true;
  const a = initiate(99);
  const b = initiate(100);
  const results = Promise.allSettled([a, b]);
  assert.equal(pending.length, 2);
  for (const d of pending) d.resolve();
  const outcomes = await results;
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(bridge.calls.size, 100);
});

test('installed Pi loader loads extension factory without starting a session', { timeout: 5000 }, async () => {
  const { loadExtensions } = await import(pathToFileURL(join(root, 'dist/core/extensions/loader.js')));
  const result = await loadExtensions([resolve('extensions/voice.mjs')], process.cwd());
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
});
