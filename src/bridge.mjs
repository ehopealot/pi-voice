import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

function normalizePhrase(value) {
  return value.toLowerCase().replace(/\p{P}/gu, '');
}

export function deny() {
  throw Error('Request denied');
}

export class Bridge {
  constructor(config, lookup, now = Date.now) {
    this.config = config;
    this.lookup = lookup;
    this.now = now;
    this.calls = new Map();
    this.failures = [];
  }

  async live(call, initiation = false) {
    let data;
    try {
      data = await this.lookup(call.sid);
    } catch {
      deny();
    }
    const c = this.config;
    const statuses = initiation ? ['ringing', 'in-progress'] : ['in-progress'];
    if (data.sid !== call.sid || data.account_sid !== c.account ||
        data.from !== c.owner || data.to !== c.number ||
        data.direction !== 'inbound' || !statuses.includes(data.status)) deny();
  }

  async initiate(secret, data) {
    const c = this.config;
    if (!equal(secret, c.initSecret) || data.agent_id !== c.agent ||
        data.caller_id !== c.owner || data.called_number !== c.number ||
        !/^CA[\da-f]{32}$/i.test(data.call_sid) ||
        typeof data.conversation_id !== 'string' ||
        !data.conversation_id || data.conversation_id.length > 128) deny();

    // Keep expired records as bounded tombstones so replay cannot refresh a call.
    const existing = [...this.calls.entries()].find(([, call]) =>
      call.sid === data.call_sid || call.conversation === data.conversation_id);
    if (existing) {
      const [token, call] = existing;
      if (call.sid !== data.call_sid || call.conversation !== data.conversation_id) deny();
      this.get(token);
      await this.live(call, true);
      this.get(token);
      return token;
    }
    if (this.calls.size >= 100) deny();
    const call = {
      sid: data.call_sid,
      conversation: data.conversation_id,
      expires: this.now() + 900000,
      attempts: 0,
      verified: false,
    };
    await this.live(call, true);
    // Lookup yields: other calls may have consumed the remaining capacity.
    if (this.calls.size >= 100) deny();
    // A simultaneous initiation must not reset attempts or mint another capability.
    if ([...this.calls.values()].some(x =>
      x.sid === call.sid || x.conversation === call.conversation)) deny();
    const token = randomBytes(32).toString('hex');
    this.calls.set(token, call);
    return token;
  }

  get(token) {
    const call = this.calls.get(token);
    if (!call || this.now() >= call.expires || call.attempts >= 3) deny();
    return call;
  }

  async verify(token, phrase) {
    const call = this.get(token);
    await this.live(call);
    this.get(token);
    this.failures = this.failures.filter(t => t > this.now() - 900000);
    if (this.failures.length >= 10) deny();
    if (typeof phrase !== 'string' || !equal(normalizePhrase(phrase), normalizePhrase(this.config.passphrase))) {
      call.attempts++;
      this.failures.push(this.now());
      deny();
    }
    call.verified = true;
    return { verified: true };
  }

  async authorize(token) {
    const call = this.get(token);
    if (!call.verified) deny();
    await this.live(call);
    this.get(token);
    return call;
  }
}
