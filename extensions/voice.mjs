import { startAgent } from '../src/agent.mjs';
import { excerpt, recentExcerpts, MAX_EXCERPTS } from '../src/excerpts.mjs';

export default function voice(pi) {
  let agent;
  let timer;
  let recentMessages = [];
  const refreshExcerpts = (_event, ctx) => {
    agent?.resetCorrelation();
    recentMessages = recentExcerpts(ctx.sessionManager.getBranch());
    agent?.update({ recentMessages });
  };
  const stop = async () => {
    clearInterval(timer);
    timer = undefined;
    await agent?.close();
    agent = undefined;
  };

  pi.on('session_start', async (_event, ctx) => {
    await stop();
    if (!process.env.PI_VOICE_IPC_DIR) return;
    agent = await startAgent(process.env.PI_VOICE_IPC_DIR, {
      id: ctx.sessionManager.getSessionId(),
      name: pi.getSessionName() || 'Unnamed Pi',
      pane: process.env.TMUX_PANE || null,
    }, text => pi.sendUserMessage(
      // Input hooks can yield while idle becomes busy; always specify delivery.
      text, { deliverAs: 'followUp' },
    ));
    refreshExcerpts(_event, ctx);
    timer = setInterval(() => agent?.update(), 5000);
    timer.unref();
  });

  pi.on('agent_start', () => agent?.update({ activity: 'working' }));
  pi.on('agent_settled', () => agent?.update({ activity: 'idle' }));
  pi.on('tool_execution_start', event => agent?.update({
    activity: `tool: ${String(event.toolName).slice(0, 80)}`,
  }));
  // Only completed user/assistant text is published, never whole messages.
  pi.on('turn_end', event => agent?.observeTurn(event.message, event.context?.contextMessages));
  pi.on('message_end', event => {
    agent?.observeMessage(event.message);
    const item = excerpt(event.message);
    if (!item) return;
    recentMessages = [...recentMessages, item].slice(-MAX_EXCERPTS);
    agent?.update({ recentMessages });
  });
  pi.on('session_tree', refreshExcerpts);
  pi.on('session_compact', refreshExcerpts);
  // Optional summary complements automatic excerpts.
  pi.registerCommand('voice-progress', {
    description: 'Publish a non-sensitive progress update to the phone bridge',
    handler: async args => { agent?.update({ progress: args }); },
  });
  pi.on('session_shutdown', stop);
}
