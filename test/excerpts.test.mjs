import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, recentExcerpts } from '../src/excerpts.mjs';

test('extracts only user text and visible assistant text from actual Pi message shapes', () => {
  assert.deepEqual(excerpt({ role: 'user', content: 'Please fix onboarding', timestamp: 123 }),
    { role: 'user', text: 'Please fix onboarding', timestamp: 123, truncated: false });
  const reply = excerpt({ role: 'assistant', stopReason: 'toolUse', timestamp: 124, content: [
    { type: 'thinking', thinking: 'PRIVATE', thinkingSignature: 'SECRET' },
    { type: 'text', text: 'Checking the tests.' },
    { type: 'toolCall', name: 'bash', arguments: { command: 'SECRET' } },
    { type: 'text', text: 'Then I will patch it.' },
  ] });
  assert.equal(reply.text, 'Checking the tests.\nThen I will patch it.');
  assert.equal(JSON.stringify(reply).includes('SECRET'), false);
  assert.equal(excerpt({ role: 'user', content: [{ type: 'image', data: 'SECRET' }] }), null);
  for (const role of ['toolResult', 'bashExecution', 'system', 'custom', 'branchSummary', 'compactionSummary']) {
    assert.equal(excerpt({ role, content: 'PRIVATE', output: 'PRIVATE' }), null);
  }
  assert.equal(excerpt({ role: 'assistant', stopReason: 'pending', content: [{ type: 'text', text: 'partial' }] }), null);
});

test('retains latest eight messages, bounds text and excludes nonmessage branch entries', () => {
  const branch = Array.from({ length: 20 }, (_, n) => ({ type: 'message', message: {
    role: n % 2 ? 'assistant' : 'user', content: n % 2 ? [{ type: 'text', text: String(n) }] : String(n), timestamp: n,
  } }));
  branch.push({ type: 'custom', data: { role: 'user', content: 'SECRET' } });
  const recent = recentExcerpts(branch);
  assert.equal(recent.length, 8);
  assert.equal(recent[0].text, '12');
  assert.equal(recent[7].text, '19');
  const long = excerpt({ role: 'user', content: 'x'.repeat(9000) });
  assert.equal(long.text.length, 800);
  assert.equal(long.truncated, true);
  assert.equal(excerpt({ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE' }] }), null);
  assert.equal(excerpt({ role: 'user', content: '[Phone instruction m1]\nFocus on tests' }).text.includes('Focus on tests'), true);
});
