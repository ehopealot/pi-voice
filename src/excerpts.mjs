export const MAX_EXCERPTS = 8;
export const MAX_EXCERPT_CHARS = 800;

// Allowlist message roles and text blocks; never serialize whole Pi messages.
export function excerpt(message) {
  if (!message || !['user', 'assistant'].includes(message.role)) return null;
  if (message.role === 'assistant' && message.stopReason === 'pending') return null;
  let text = '';
  let truncated = false;
  const append = value => {
    if (typeof value !== 'string' || !value) return;
    const separator = text ? '\n' : '';
    const available = MAX_EXCERPT_CHARS - text.length;
    const part = separator + value.slice(0, MAX_EXCERPT_CHARS);
    if (separator.length + value.length > available) truncated = true;
    text += part.slice(0, available);
  };
  if (message.role === 'user' && typeof message.content === 'string') {
    append(message.content);
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type === 'text') append(block.text);
    }
  }
  if (!text.trim()) return null;
  return {
    role: message.role,
    text,
    timestamp: Number.isFinite(message.timestamp) ? message.timestamp : null,
    truncated,
  };
}

export function recentExcerpts(branch) {
  const recent = [];
  for (let i = branch.length - 1; i >= 0 && recent.length < MAX_EXCERPTS; i--) {
    if (branch[i]?.type !== 'message') continue;
    const item = excerpt(branch[i].message);
    if (item) recent.push(item);
  }
  return recent.reverse();
}
