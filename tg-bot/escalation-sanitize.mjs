// escalation-sanitize.mjs -- independent pure-function module (no side effects, no imports), used by
// owner-bot.mjs Direction C. Split out because owner-bot.mjs constructs `new Bot(token)` at module top
// level (needs OWNER_BOT_TOKEN to import), and unit tests need a zero-dependency import target (same
// spirit as H1 "independent literal array": physically isolate logic from runtime side effects).
//
// 2026-07-17 (Bettor#omp36y GREEN, NWT redteam c96fc9f9 #7 MUST-FIX): raw_text used to be spliced
// verbatim after the label with zero escaping/truncation/structural separation. User text could
// impersonate a fake system correction claiming Owner approval and read like an independent
// instruction inside a broadcast whose sender is the Owner's real relay. Fix (NWT suggestions 1+2):
// newline folding removes the layout space needed to fake multiple lines / separate messages; length
// truncation shrinks the usable injection payload. The fence (NWT suggestion 1) is applied by the
// caller (owner-bot.mjs) around the sanitized text.
//
// 2026-07-17 patch (NWT diff verdict PUSH-BACK on commit 8446d4fb, two live-tested bypasses; see
// docs/2026-07-17-NWT-redteam-escalation-sanitize-diff-verdict-8446d4fb.md):
// Bypass 1 (severe): raw_text containing a literal fence end-marker substring produces a second
// end-marker in the assembled body -- a skimming reader treats the fake one as the end of the
// protected zone, so content still inside the real fence gets misread as trusted (delimiter
// injection). Fix: after folding, collapse any run of 3+ hyphens down to 2 -- the fence markers need
// exactly 3 leading hyphens, so raw_text can never reconstruct that sequence after this pass.
// Bypass 2 (medium): the newline-folding pass only covered CR/LF, missing the Unicode line and
// paragraph separator code points (decimal 8232, 8233, 133), which some rendering surfaces still
// treat as line breaks. Fix: fold those three code points too, built via String.fromCharCode with a
// plain decimal number rather than a typed backslash-u escape (escape literals proved unreliable to
// author correctly through this edit pipeline).
export const RAW_TEXT_PREVIEW_MAX = 400;

const FOLD_MARKER = ' ⏎ ';
const LINE_SEP = String.fromCharCode(8232);
const PARA_SEP = String.fromCharCode(8233);
const NEL = String.fromCharCode(133);

function foldNewlineEquivalents(text) {
  let out = text.split('\r\n').join(FOLD_MARKER);
  out = out.split('\r').join(FOLD_MARKER);
  out = out.split('\n').join(FOLD_MARKER);
  out = out.split(LINE_SEP).join(FOLD_MARKER);
  out = out.split(PARA_SEP).join(FOLD_MARKER);
  out = out.split(NEL).join(FOLD_MARKER);
  return out;
}

function collapseFenceMarkers(text) {
  return text.replace(/-{3,}/g, '--');
}

export function sanitizeRawTextForBroadcast(raw, ticketShort) {
  if (!raw) return '(无)';
  let folded = collapseFenceMarkers(foldNewlineEquivalents(String(raw)));
  if (folded.length > RAW_TEXT_PREVIEW_MAX) {
    return folded.slice(0, RAW_TEXT_PREVIEW_MAX) + '...[截断, 完整原文见 console 工单#' + ticketShort + ']';
  }
  return folded;
}
