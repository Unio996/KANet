#!/usr/bin/env node
// receipt-required-hook.mjs — mechanical enforcement of ANTI-PATTERNS 规则 48
// ("工具调用写成纯文本 = 废稿"). Bettor/J1/NWT/KANet-UI consensus 2026-06-15: discipline-alone
// failed (Owner 暴怒数十次) → mechanize. J1 designed, KANet-UI landed (hook 域 + 单写者).
//
// WIRE as a Claude Code **Stop hook** (.claude/settings.json):
//   "hooks": { "Stop": [ { "hooks": [ { "type": "command",
//       "command": "node scripts/receipt-required-hook.mjs" } ] } ] }
// The Stop hook receives JSON on stdin incl. `transcript_path`. We scan the LAST assistant turn:
// if it makes a completion claim (已发/已push/已commit/...) but the same turn has NO receipt token
// (txid / sha / exit 0 / landed / SENT) in its tool RESULTS → warn "声称完成无回执=疑废稿".
//
// Non-blocking by design: prints a warning to stderr (surfaced to the model) but exits 0 — a buggy
// hard-block would disrupt every turn. The warning is the nudge; cross-agent @打脸 is the backstop.

import { readFileSync } from 'node:fs';

// completion claims (the agent says it DID something outward/durable)
const CLAIM = /(已发|已 ?push|已 ?commit|已 ?跑|已部署|已排|已落地|已广播|sent to channel|pushed to origin|committed|已 ?merge|已 ?deploy)/i;
// receipt tokens (proof the tool actually ran) — any one in the turn's tool RESULTS clears the claim
const RECEIPT = /([0-9a-f]{12,64}|sent [0-9a-f]{6,}|landed["\s:]+true|exit (code )?0|HEAD:|->\s+docs\/|->\s+origin|✓ \d+ files clean|PASS|Next wakeup scheduled|"ok"\s*:\s*true|txId)/i;

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
  let payload = {};
  try { payload = JSON.parse(readStdin() || '{}'); } catch { /* tolerate */ }
  const tpath = payload.transcript_path;
  if (!tpath) return ok(); // no transcript → nothing to check

  let lines;
  try { lines = readFileSync(tpath, 'utf8').split('\n').filter(Boolean); }
  catch { return ok(); } // can't read → don't disrupt

  // walk back: collect the last assistant turn = assistant text(s) + tool_result(s) since last user msg
  const turn = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let m; try { m = JSON.parse(lines[i]); } catch { continue; }
    const role = m.role || m.type || m?.message?.role;
    turn.unshift(m);
    if (role === 'user' && i < lines.length - 1) break; // reached the user msg that opened this turn
    if (turn.length > 200) break; // safety bound
  }

  // assistant text in this turn
  let assistantText = '';
  let toolResults = '';
  for (const m of turn) {
    const content = m?.message?.content ?? m?.content;
    if (!content) continue;
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: String(content) }];
    for (const b of blocks) {
      if (b?.type === 'text' && (m.role === 'assistant' || m?.message?.role === 'assistant')) assistantText += '\n' + (b.text || '');
      if (b?.type === 'tool_result') toolResults += '\n' + JSON.stringify(b.content || '');
      // some transcript shapes put tool results on user/tool messages
      if ((m.role === 'tool' || m.role === 'user') && b?.type === 'text') toolResults += '\n' + (b.text || '');
    }
    if (typeof content === 'string' && (m.role === 'tool' || m.role === 'user')) toolResults += '\n' + content;
  }

  if (CLAIM.test(assistantText) && !RECEIPT.test(toolResults)) {
    process.stderr.write(
      '⚠ receipt-required (规则48): 末条输出含完成词(已发/已push/…)但同 turn tool_result 无回执 token' +
      '(txid/sha/exit0/landed/SENT)。可能是“工具调用写成纯文本=废稿”。核回执后再报完成。\n'
    );
    // exit 0 (non-blocking) — surface the warning, don't hard-stop the session.
  }
  return ok();
}

function ok() { process.exit(0); }
main();
