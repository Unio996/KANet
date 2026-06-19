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
// receipt tokens — actual txids are caught by the 12-64 hex; the bare word "txid" is NOT a token
// (else a failure result like "no txid here" false-passes — Bettor/KANet-UI test fixture lesson).
const RECEIPT = /([0-9a-f]{12,64}|sent [0-9a-f]{6,}|landed["\s:]+true|exit (code )?0|HEAD:|->\s+docs\/|->\s+origin|✓ \d+ files clean|PASS|Next wakeup scheduled|"ok"\s*:\s*true|"txId"\s*:)/i;

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

  // walk back to collect THIS turn: assistant text(s) + tool_result(s), stopping at the REAL user
  // PROMPT that opened the turn. ⚠ In real Claude Code transcripts tool_result is a role=user message
  // (Bettor bug on 4874b2ef: breaking at the first role=user = the last tool_result = missed the
  // assistant text above = CLAIM never fired). Only break at a user msg carrying NO tool_result block.
  // Also: each block (thinking/text/tool_use/tool_result) is usually its OWN message line.
  let assistantText = '';
  let toolResults = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    let m; try { m = JSON.parse(lines[i]); } catch { continue; }
    const role = m.role || m?.message?.role;
    const content = m?.message?.content ?? m?.content;
    const blocks = Array.isArray(content) ? content : (content != null ? [{ type: 'text', text: String(content) }] : []);
    const isToolResultMsg = role === 'user' && blocks.some((b) => b?.type === 'tool_result');
    if (role === 'user' && !isToolResultMsg && i < lines.length - 1) break; // real prompt = turn opener
    if (role === 'assistant') {
      for (const b of blocks) if (b?.type === 'text') assistantText += '\n' + (b.text || '');
    } else if (isToolResultMsg) {
      for (const b of blocks) if (b?.type === 'tool_result') toolResults += '\n' + JSON.stringify(b.content ?? '');
    }
    if (assistantText.length + toolResults.length > 300000) break; // safety bound
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
