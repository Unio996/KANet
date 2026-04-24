// dev-coord channel poller — 5s interval, outputs new messages to stdout
// AND to logs/dev-coord-monitor.log so a human owner can `tail -f` it
// from a normal shell (bg task stdout sits in a Claude-only temp dir).
//
// Previous bugs fixed: no fetch timeout, silent error swallowing,
// no in-flight lock, findIndex losing messages when lastId falls out
// of the limit=80 window (timestamp fallback recovers).

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CONSOLE = 'http://localhost:3100';
const CHANNEL = 'dev-coord';
const POLL_MS = 5000;
const FETCH_TIMEOUT_MS = 4000;
const LOG_FILE = process.env.DEV_COORD_LOG
  || (process.env.KANET_ROOT ? `${process.env.KANET_ROOT}/logs/dev-coord-monitor.log`
                              : 'D:/Anthropic/logs/dev-coord-monitor.log');
try { mkdirSync(dirname(LOG_FILE), { recursive: true }); } catch {}

// stdout: one line per event (Monitor notification). Must be short.
// log file: full payload (summary + full content if provided). Tail -f.
function emit(summary, fullPayload) {
  process.stdout.write(summary + '\n');
  const toLog = fullPayload ? `${summary}\n${fullPayload}\n--- end ---` : summary;
  try { appendFileSync(LOG_FILE, toLog + '\n'); } catch {}
}

let lastId = null;
let lastSeenAt = null;  // ISO timestamp fallback when lastId falls out of window
let inFlight = false;
let errCount = 0;

function ts() {
  return new Date().toISOString().slice(11, 19);
}

async function poll() {
  if (inFlight) return;  // skip overlapping tick
  inFlight = true;
  try {
    const res = await fetch(`${CONSOLE}/api/chat/messages?channel=${CHANNEL}&limit=80`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      emit(`[${ts()}] poll HTTP ${res.status}`);
      return;
    }
    const { messages } = await res.json();
    errCount = 0;  // reset on success
    if (!messages?.length) return;

    if (!lastId) {
      // First poll — anchor cursor at current newest, don't dump history
      const newest = messages[messages.length - 1];
      lastId = newest.id;
      lastSeenAt = newest.created_at;
      emit(`[${ts()}] poll INIT · cursor=${lastId.slice(0, 8)} @ ${lastSeenAt.slice(11, 19)}`);
      return;
    }

    // Primary: find by id in the window
    const lastIdx = messages.findIndex(m => m.id === lastId);
    let newMsgs;
    if (lastIdx >= 0) {
      newMsgs = messages.slice(lastIdx + 1);
    } else {
      // Fallback: lastId fell out of limit=80 window. Use timestamp cursor
      // to recover rather than reset to "no history".
      newMsgs = messages.filter(m => m.created_at > lastSeenAt);
      emit(`[${ts()}] lastId fell out of window — timestamp fallback recovered ${newMsgs.length}`);
    }

    for (const m of newMsgs) {
      const who = m.sender_address?.includes('qqjdpjp0') ? 'Eric'
        : m.sender_address?.includes('qptg465') ? 'Martin(J1)'
        : m.sender_address?.includes('qr7km875') ? 'J2'
        : m.sender_address?.slice(-12);
      const content = m.content || '';
      const preview = content.split('\n')[0].slice(0, 120);
      const summary = `[${m.created_at?.slice(11,19)}] ${who}: ${preview}${content.length > 120 ? ' …' : ''}`;
      emit(summary, content);
    }

    if (newMsgs.length) {
      const last = newMsgs[newMsgs.length - 1];
      lastId = last.id;
      lastSeenAt = last.created_at;
    }
  } catch (err) {
    errCount++;
    // Log first error loudly; thereafter every 12th (~1 per minute at 5s tick)
    if (errCount === 1 || errCount % 12 === 0) {
      emit(`[${ts()}] poll error (x${errCount}): ${err.name || ''} ${err.message}`);
    }
  } finally {
    inFlight = false;
  }
}

emit(`[${ts()}] dev-coord-poll started · channel=${CHANNEL} · ${POLL_MS}ms tick · ${FETCH_TIMEOUT_MS}ms fetch timeout`);
setInterval(poll, POLL_MS);
poll();
