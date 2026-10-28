import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
// Short IPC round trips retain existing deadlines; no waiter lives in Pi.
export async function waitForReply(read, signal, duration = 8000) {
  signal?.throwIfAborted();
  const end = performance.now() + duration;
  let result = await read();
  while (!result.response && performance.now() < end) {
    await delay(Math.min(250, end - performance.now()), undefined, {signal});
    signal?.throwIfAborted();
    result = await read();
  }
  signal?.throwIfAborted();
  return {...result, wait: result.response ? 'reply' : 'timed_out'};
}
