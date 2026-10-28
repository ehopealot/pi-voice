import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, chmod, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { server } from './http.mjs';
import { excerpt, MAX_EXCERPTS } from './excerpts.mjs';

function userText(message) {
  if (message?.role !== 'user') return null;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content) || message.content.some(b => b?.type !== 'text')) return null;
  return message.content.map(b => b.text).join('\n');
}

export async function privateDir(dir) {
  dir = resolve(dir);
  await mkdir(dir, { mode: 0o700, recursive: true });
  const s = await lstat(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) {
    throw Error('IPC directory must be owner-only');
  }
  return dir;
}

export async function startAgent(dir, identity, send, now = Date.now) {
  dir = await privateDir(dir);
  const instance = randomUUID();
  const path = join(dir, instance + '.sock');
  let state = {
    id: String(identity.id).slice(0, 128),
    name: String(identity.name).slice(0, 120),
    pane: identity.pane ? String(identity.pane).slice(0, 32) : null,
    instance, activity: 'idle', progress: '', recentMessages: [], updated: now(),
  };
  const receipts = new Map();
  let active;
  let ambiguous = false;
  let userSeen = false;
  const envelopes = new Map();
  const s = server(async (_url, _headers, data) => {
    if (data.op === 'status') return { ...state, stale: now() - state.updated > 30000 };
    if (data.op !== 'message' || now() - state.updated > 30000 ||
        typeof data.id !== 'string' || !/^[\w-]{1,80}$/.test(data.id) ||
        typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) throw Error();
    const old = receipts.get(data.id);
    if (old) {
      if (old.text !== data.text) throw Error();
      return old.result;
    }
    if (receipts.size >= 1000) throw Error();
    // Reserve before submission. The public Pi API returns void and catches async
    // failures elsewhere; neither return nor exception confirms ingestion.
    const item = { text: data.text, result: { id: data.id, receipt: 'indeterminate', acted: false } };
    receipts.set(data.id, item);
    try {
      const envelope = `[Phone instruction ${data.id}; ${randomUUID()}]\n${data.text}`;
      item.envelope = envelope;
      envelopes.set(envelope, item);
      item.result = { id: data.id, receipt: 'submitted_unconfirmed', acted: false };
      send(envelope);
    } catch {
      // Never retry silently: Pi might have accepted the message before throwing.
      if (!item.result.response) item.result = { id: data.id, receipt: 'indeterminate', acted: false };
    }
    return item.result;
  });
  await new Promise((ok, bad) => { s.once('error', bad); s.listen(path, ok); });
  await chmod(path, 0o600);
  let closed = false;
  return {
    path,
    resetCorrelation() { active = undefined; ambiguous = false; userSeen = false; envelopes.clear(); },
    observeMessage(message) {
      if (message?.role !== 'user') return;
      const text = userText(message);
      if (userSeen) ambiguous = true;
      userSeen = true;
      active = envelopes.get(text);
      envelopes.delete(text);
    },
    observeTurn(message, projectedMessages) {
      // message_end runs before later extensions can replace its input. Confirm
      // against the projected boundary context after that replacement chain.
      if (active) {
        const users = Array.isArray(projectedMessages) ? projectedMessages.filter(m => m?.role === 'user') : [];
        if (users.length === 0 || userText(users.at(-1)) !== active.envelope ||
            users.filter(m => userText(m) === active.envelope).length !== 1) active = undefined;
      }
      if (message?.stopReason !== 'toolUse') userSeen = false;
      if (ambiguous || !['stop', 'toolUse'].includes(message?.stopReason)) {
        active = undefined;
        if (message?.stopReason !== 'toolUse') ambiguous = false;
        return;
      }
      if (!active || message?.role !== 'assistant' || message.stopReason !== 'stop' ||
          message.content?.some(b => b.type === 'toolCall')) return;
      const response = excerpt(message);
      if (response) active.result = { ...active.result, receipt: 'response_observed', response };
      active = undefined;
    },
    update(data = {}) {
      state = {
        ...state,
        activity: String(data.activity ?? state.activity).slice(0, 120),
        progress: String(data.progress ?? state.progress).slice(0, 2000),
        recentMessages: Array.isArray(data.recentMessages)
          ? data.recentMessages.slice(-MAX_EXCERPTS).map(item => {
            const bounded = excerpt({ role: item?.role, content: [{ type: 'text', text: item?.text }], timestamp: item?.timestamp });
            if (bounded) bounded.truncated ||= item.truncated === true;
            return bounded;
          }).filter(Boolean)
          : state.recentMessages,
        updated: now(),
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise(r => s.close(r));
      await unlink(path).catch(() => {});
    },
  };
}

export function ipc(path, data) {
  return new Promise((ok, bad) => {
    const req = http.request({
      socketPath: path, path: '/', method: 'POST', timeout: 2000,
      headers: { 'content-type': 'application/json' },
    }, res => {
      let text = '';
      res.on('data', c => {
        text += c;
        if (Buffer.byteLength(text) > 65536) req.destroy(Error('IPC response too large'));
      });
      res.on('error', bad);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw Error('IPC denied');
          ok(JSON.parse(text));
        } catch (e) { bad(e); }
      });
    });
    req.on('error', bad);
    req.on('timeout', () => req.destroy(Error('IPC timeout')));
    req.end(JSON.stringify(data));
  });
}

export async function listAgents(dir) {
  await privateDir(dir);
  const files = (await readdir(dir)).filter(x => /^[\da-f-]{36}\.sock$/.test(x)).slice(0, 100);
  return (await Promise.all(files.map(async file => {
    const path = join(dir, file);
    try {
      const st = await lstat(path);
      if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o077)) return null;
      return await ipc(path, { op: 'status' });
    } catch {
      return { instance: file.slice(0, -5), stale: true, activity: 'unreachable' };
    }
  }))).filter(Boolean);
}

export async function messageAgent(dir, instance, id, text) {
  if (typeof instance !== 'string' || !/^[\da-f-]{36}$/.test(instance)) throw Error();
  await privateDir(dir);
  return ipc(join(dir, instance + '.sock'), { op: 'message', id, text });
}
