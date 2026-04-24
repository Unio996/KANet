// dev-coord channel poller — 5s interval, outputs new messages to stdout
const CONSOLE = 'http://localhost:3100';
const CHANNEL = 'dev-coord';
let lastId = null;

async function poll() {
  try {
    const res = await fetch(`${CONSOLE}/api/chat/messages?channel=${CHANNEL}&limit=80`);
    const { messages } = await res.json();
    if (!messages?.length) return;

    if (!lastId) {
      // First poll — just record the latest ID, don't dump history
      lastId = messages[messages.length - 1].id;
      return;
    }

    // Find new messages after lastId
    const lastIdx = messages.findIndex(m => m.id === lastId);
    const newMsgs = lastIdx >= 0 ? messages.slice(lastIdx + 1) : [];

    for (const m of newMsgs) {
      const who = m.sender_address?.includes('qqjdpjp0') ? 'Eric'
        : m.sender_address?.includes('qptg465') ? 'Martin'
        : m.sender_address?.includes('qr7km875') ? '139-Martin'
        : m.sender_address?.slice(-12);
      console.log(`[${m.created_at?.slice(11,19)}] ${who}: ${m.content}`);
    }

    if (newMsgs.length) lastId = newMsgs[newMsgs.length - 1].id;
  } catch (err) {
    // silent retry
  }
}

setInterval(poll, 5000);
poll();
