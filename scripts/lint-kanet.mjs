#!/usr/bin/env node
// lint-kanet.mjs — KANet 工程陷阱静态扫 (T-NWT-2026-04-26)
//
// 强制 ANTI-PATTERNS.md 规则在 commit 前过. git pre-commit hook 调.
// 失败一条 commit 都不让. 用法:
//   node scripts/lint-kanet.mjs           # 扫整库
//   node scripts/lint-kanet.mjs <file>... # 扫特定文件 (pre-commit hook 用)
//
// 当前规则 (按 ANTI-PATTERNS.md 编号对应):
//   R9  Qwen LLM caller 必有 chat_template_kwargs.enable_thinking=false
//   R10 broker DM kind (_qDm / _enqueue 'dm_*') 必在 broker-action-queue TX_PRODUCING_KINDS 里
//   R11 中文 deterministic regex 含 PAID|FINISH 类完成动作必含 (?:了)? 后缀
//   R6  send broadcast / chat send 必显式带 relayId (不从 LLM/payload 拿)
//   R19 broker SYSTEM_PROMPT/template 不准 hardcoded 完整 EVM 地址 (LLM 会 copy = 钱丢, J1 67903c5b)
//   misc SQL prepare 不准 string interpolation (防 inject)
//
// 不是 ESLint 替代, 是 KANet-specific 模式. 跑 1-2s 完.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const violations = [];
const file = (rel) => path.join(ROOT, rel);
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const read = (p) => fs.readFileSync(p, 'utf8');

function violate(rule, msg, file, line) {
  violations.push({ rule, msg, file, line });
}

function* walk(dir, ext = ['.js', '.mjs']) {
  const skip = new Set(['node_modules', '.git', 'logs', 'dist', 'build', 'out', '.cache', '__tests__']);
  for (const name of fs.readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full, ext);
    else if (st.isFile() && ext.some(e => name.endsWith(e))) yield full;
  }
}

// ── 输入: argv 给的 file 列表, 或全库扫 ──
const argv = process.argv.slice(2);
const targets = argv.length > 0
  ? argv.map(p => path.resolve(p)).filter(exists)
  : [...walk(path.join(ROOT, 'kasia-console/src')), ...walk(path.join(ROOT, 'agent-mind/src')), ...walk(path.join(ROOT, 'agent-adapter/src')), ...walk(path.join(ROOT, 'scripts'))];

console.log(`[lint-kanet] scanning ${targets.length} files...`);

// ── R9: Qwen LLM caller 必有 chat_template_kwargs.enable_thinking=false ──
// 检测: fetch 调 /chat/completions 的 body 里没 chat_template_kwargs.enable_thinking=false
// 排除: openai.com / api.anthropic.com (非 Qwen, 不需此 kwarg)
function checkR9(filepath, content) {
  const lines = content.split('\n');
  // 简化检 fetch...chat/completions 的紧邻 body 块. 5-50 行 window 看是否含 chat_template_kwargs
  const callPattern = /fetch\s*\([^)]*?chat\/completions/g;
  let m;
  while ((m = callPattern.exec(content)) !== null) {
    const callStart = content.slice(0, m.index).split('\n').length;
    // 取 callStart 起 50 行 body 检
    const block = lines.slice(callStart - 1, callStart + 50).join('\n');
    // 排除 openai/anthropic
    if (/openai\.com|api\.anthropic\.com|api\.openai/i.test(block)) continue;
    // body 里若含 model: ... messages: ... tools 等 (Qwen 模式) 必有 chat_template_kwargs
    const looksQwen = /model\s*:\s*['"`].*[Qq]wen|model\s*:\s*a\.ai_model|qwen|local.*llama/i.test(block);
    const hasKwarg = /chat_template_kwargs[^=]*enable_thinking\s*:\s*false/i.test(block);
    if (looksQwen && !hasKwarg) {
      violate('R9', '[ANTI-PATTERNS R9] Qwen LLM caller 漏 chat_template_kwargs.enable_thinking=false (Rule 11) — broker LLM 60-120s timeout 真因. 复制 agent-adapter/src/providers/openai.mjs:141 模式.', filepath, callStart);
    }
  }
}

// ── R10: 新 broker DM kind 必注册 broker-action-queue ──
// 提取所有 _qDm/_enqueue('dm_*') 调用 vs broker-action-queue TX_PRODUCING_KINDS Set + executeAction case
function checkR10() {
  const queueFile = file('kasia-console/src/services/broker-action-queue.js');
  if (!exists(queueFile)) return;
  const queueContent = read(queueFile);
  // 提 TX_PRODUCING_KINDS Set 内容
  const setMatch = queueContent.match(/TX_PRODUCING_KINDS\s*=\s*new\s+Set\s*\(\s*\[([^\]]+)\]/);
  const registered = setMatch ? new Set(setMatch[1].match(/['"`]([^'"`]+)['"`]/g)?.map(s => s.slice(1, -1)) || []) : new Set();
  // executeAction case 列表
  const caseMatches = [...queueContent.matchAll(/case\s+['"`]([^'"`]+)['"`]\s*:/g)];
  const cased = new Set(caseMatches.map(m => m[1]));

  // 扫所有 _qDm('dm_*') / enqueue({ kind: 'dm_*' }) 调用
  const used = new Set();
  for (const fp of targets) {
    if (fp === queueFile) continue;
    if (!fp.includes('broker') && !fp.includes('exchange') && !fp.includes('watcher')) continue;
    const c = read(fp);
    for (const m of c.matchAll(/_qDm\(\s*['"`](dm_[a-z_]+)['"`]/g)) used.add(m[1]);
    for (const m of c.matchAll(/enqueue\s*\(\s*\{\s*kind\s*:\s*['"`](dm_[a-z_]+)['"`]/g)) used.add(m[1]);
  }
  for (const kind of used) {
    if (!registered.has(kind)) {
      violate('R10', `[ANTI-PATTERNS R10] DM kind '${kind}' 没在 broker-action-queue.js TX_PRODUCING_KINDS 注册 — pump 时 throw 'unknown queue kind' retry 3 × 6s = 18s 阻塞 + anti-spam 拒重发.`, queueFile, 0);
    }
    if (!cased.has(kind)) {
      violate('R10', `[ANTI-PATTERNS R10] DM kind '${kind}' 没在 broker-action-queue.js executeAction switch 加 case — 同上 throw.`, queueFile, 0);
    }
  }
}

// ── R11: 中文 deterministic 完成动作 regex 必含 (?:了)? 后缀 ──
// 检测: const X_REGEX = /^(...|完成|付了|转完|done|...)\s*[!！。.…]*\s*$/  无 (?:了)?
function checkR11(filepath, content) {
  const lines = content.split('\n');
  // 看变量名含 PAID/FINISH/DONE 的 regex literal
  const re = /const\s+(\w*(?:PAID|FINISH|DONE|COMPLETE)\w*_REGEX)\s*=\s*(\/[^\n]+\/[gimsu]*)/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const lineNo = content.slice(0, m.index).split('\n').length;
    const regexStr = m[2];
    // 含 完成 / 付了 / done 类 + 中文范围 (有 一-鿿 或 中文字符) → 必含 (?:了|啦)?
    const hasChinese = /[一-鿿]/.test(regexStr);
    if (!hasChinese) continue;
    // 仅检 anchored deterministic regex (^...$), 排除 capture 类 (有未转义 group) — 那是 extract 不是 detect
    const isAnchored = /^\/\^/.test(regexStr) && /\$\/[gimsu]*$/.test(regexStr);
    if (!isAnchored) continue;  // PAID_REGEX 是 capture (\b0x[hex]{64}\b), 不需此规则
    const hasEndMarker = /\(\?\:\s*了/.test(regexStr) || /\[了啦/.test(regexStr);
    if (!hasEndMarker) {
      violate('R11', `[ANTI-PATTERNS R11] ${m[1]} 中文 deterministic regex 漏完成态助词 (?:了)? 后缀 — 'X 了' 类 user 输入静默 fall LLM → 60-120s timeout (R9 真因). 加 \\s*(?:了|啦)?\\s* 在主词后.`, filepath, lineNo);
    }
  }
}

// ── R6: 链上 send 必显式 relayId (不从 LLM/payload/header 拿) ──
function checkR6(filepath, content) {
  // 检 fetch '/api/chat/send' body 含 relayId
  // 简化: 扫 /api/chat/send POST body, 看是否含 'relayId:' 字面量 (变量也算)
  // 真正复杂场景手动 review.
  const lines = content.split('\n');
  const re = /fetch\s*\([^)]*\/api\/chat\/send/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const callStart = content.slice(0, m.index).split('\n').length;
    // 扩 window: fetch 前 30 行 + 后 20 行 (body 常 const 在 fetch 上面)
    const winStart = Math.max(0, callStart - 30);
    const block = lines.slice(winStart, callStart + 20).join('\n');
    if (!/relayId/.test(block)) {
      violate('R6', '[ANTI-PATTERNS R6] /api/chat/send 调用没显式传 relayId — 可能身份冒用 (2026-04-24 J2 冒用事件). 必 CFG.relayId / hardcode 自己 daemon relay.', filepath, callStart);
    }
  }
}

// ── R19: broker SYSTEM_PROMPT / preview_text 不准含 hardcoded EVM 地址 ──
// J1 67903c5b 真测撞: SYSTEM_PROMPT example 含 `0xaD12544E...` LLM 直接 copy 当真地址输出.
// 真 user 真转 USDT 到 LLM 编的 placeholder = 钱永久丢. 防御: SYSTEM_PROMPT 严禁完整 0x{40hex}, 用 '后端注入' 代.
function checkR19(filepath, content) {
  // 只检 broker-llm-agent / broker-buy-handler 等 broker 服务文件
  if (!/broker-(llm-agent|buy-handler|sell-handler|action-queue)\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过 // 单行注释 和 doc 注释 (broker 拿真 owner BSC 0xaD12... 注释里讨论 case 不 lint)
    if (/^\s*\/\//.test(line)) continue;
    // 跳过 import 语句 / 单纯字符串变量赋值
    const m = line.match(/0x[a-fA-F0-9]{40}/);
    if (!m) continue;
    // 在 string template / 普通 string 字面量里 → 命中 (LLM/template 会 copy)
    const isInString = /["'`].*0x[a-fA-F0-9]{40}.*["'`]/.test(line);
    if (isInString) {
      violate('R19', `[ANTI-PATTERNS R19] broker 服务文件 SYSTEM_PROMPT/template 含 hardcoded EVM 地址 '${m[0]}' — LLM 会 copy 当真地址 (J1 67903c5b 真测撞 fake placeholder bug, 真 user 真转 USDT 钱丢). 改用 \\\${makerWallet.address} 后端真 fetch.`, filepath, i + 1);
    }
  }
}

// ── R33: broker reply path 真 ALL consult conversation state authority ──
// 真 ANTI-PATTERNS R33 (J1 sediment 3b6911f3): 真 broker handler reply 真 generate 真 BEFORE
// 真 must consult getConvoState/shouldDeterministicFire 真 prevent 11+ paths fragmented blind.
//
// 真 heuristic: scan broker-buy-handler / broker-sell-handler / broker-llm-agent for reply
// generation patterns (return string literal / _qDm / _enqueue / reply.send) — flag any
// reply path 真 NOT preceded (within ~30 line window) by getConvoState OR shouldDeterministicFire
// import OR call. R33 hasn't shipped yet, so initial state: warn only on broker handler files.
//
// 真 phase 1 (current): warn-only — broker handler missing R33 imports
// 真 phase 2 (post J2 R33 broker code ship): strict — every reply path requires gating call
function checkR33(filepath, content) {
  // 只 broker handler 文件
  if (!/broker-(llm-agent|buy-handler|sell-handler)\.js$/.test(filepath)) return;

  // 真 R33 expected imports / API surface (允 .js 扩展名)
  const hasR33Import = /from\s+['"`]\.\/broker-state-authority(?:\.js)?['"`]|require\(\s*['"`]\.\/broker-state-authority(?:\.js)?['"`]/.test(content);
  // 真 R33 API 6 个: getConvoState/setConvoStateLock/resetConvoState/shouldDeterministicFire/llmSystemPromptStateLock/validateLlmReply
  // broker-llm-agent 用 LLM 专 surface (set+systemPrompt+validate), 不一定 call getConvoState/shouldDeterministicFire 直接
  const hasR33ApiCall = /\b(?:getConvoState|setConvoStateLock|resetConvoState|shouldDeterministicFire|llmSystemPromptStateLock|validateLlmReply)\s*\(/.test(content);

  // count reply-generation sites (heuristic — return string + _qDm + enqueue dm_*)
  const replyPaths = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line)) continue;
    // return literal string OR template literal
    if (/^\s*return\s+['"`]/.test(line) || /return\s+`[\s\S]*?`/.test(line)) replyPaths.push(i + 1);
    // _qDm or _enqueue dm_*
    if (/_qDm\s*\(|_enqueue\s*\(\s*['"`]dm_/.test(line)) replyPaths.push(i + 1);
  }

  if (replyPaths.length === 0) return;  // no reply generation, no R33 concern

  // Phase 2 strict (post J2 R33 broker code ship 371e4ca62): broker handlers WITH
  // reply paths MUST import broker-state-authority AND call at least 1 R33 API. Otherwise commit blocked.
  if (!hasR33Import || !hasR33ApiCall) {
    violate('R33', `[ANTI-PATTERNS R33] broker handler ${replyPaths.length} reply paths 必 consult conversation state authority. Import broker-state-authority.js + 调 R33 API (getConvoState/setConvoStateLock/resetConvoState/shouldDeterministicFire/llmSystemPromptStateLock/validateLlmReply 任一). R33 design: docs/ANTI-PATTERNS.md.`, filepath, replyPaths[0]);
  }
}

// ── R33b: user-supplied conditions retention pipeline (4 step, J1 NWT GAP B + J2 真根因) ──
// 真 ANTI-PATTERNS.md '规则 33b': user 条件 (limit_price / refund_timeout_min) 必经 4 步 pipeline.
// (1) regex extract in _extractFieldsFromMsg
// (2) tool schema 含 optional conditions params
// (3) 透传 preview function (buyPreview/sellPreview signature 含 conditions)
// (4) preview_text echo accept/reject (broker 决策可见)
//
// 真 lint heuristic: 检查 4 步至少头 3 步在源码可见 (step 4 是 runtime 行为, 不静态可查).
// 真 J1 6e77cb55 + 226da7ac + 9bc6c3aa 真**真**真已落地 — 此 lint 防 future 扩 SOL/TRON/USDC 时
// 漏一步重蹈 B3b silent drop 覆辙.
function checkR33b(filepath, content) {
  // broker-llm-agent: 真**真**真 _extractFieldsFromMsg 真 contain conditions extract regex
  if (/broker-llm-agent\.js$/.test(filepath)) {
    const hasExtractConditions = /limit_price\s*[:?]?\s*(?:limitMatch|fresh\.limit_price|prev\.limit_price)|挂单价|限价/.test(content);
    const hasToolSchemaConditions = /(?:limit_price|refund_timeout_min)\s*:\s*\{\s*type/.test(content);
    if (!hasExtractConditions) {
      violate('R33b', `[ANTI-PATTERNS R33b] broker-llm-agent.js _extractFieldsFromMsg 必 extract user 条件 (limit_price 等). Pipeline step 1 missing — 重蹈 B3b silent drop. 加 regex 匹 '挂单价/限价/不低于' 等. R33b doc: docs/ANTI-PATTERNS.md '规则 33b'.`, filepath, 1);
    }
    if (!hasToolSchemaConditions) {
      violate('R33b', `[ANTI-PATTERNS R33b] broker-llm-agent.js TOOLS preview_order schema 必含 limit_price + refund_timeout_min optional params. Pipeline step 2 missing.`, filepath, 1);
    }
  }
  // broker-buy-handler / broker-sell-handler: preview function signature 真 contain conditions destructured
  if (/broker-(buy|sell)-handler\.js$/.test(filepath)) {
    // 真**真**真 export async function buyPreview({...}) 真 destructure 真**真**真 contain 'limit_price'
    const previewFnRe = /export\s+async\s+function\s+(?:buy|sell)Preview\s*\(\s*\{[\s\S]{0,800}?\}/;
    const m = previewFnRe.exec(content);
    if (m) {
      const sig = m[0];
      if (!/limit_price/.test(sig) || !/refund_timeout_min/.test(sig)) {
        violate('R33b', `[ANTI-PATTERNS R33b] ${filepath.match(/broker-(buy|sell)-handler/)[0]}.js preview function signature 必 destructure limit_price + refund_timeout_min (R33b pipeline step 3). 漏 = silent drop. R33b doc: docs/ANTI-PATTERNS.md.`, filepath, 1);
      }
    }
  }
}

// R-NWT-2026-04-28 Layer 5 (Z21 root + future regression防): broker → relay command type
// must be from canonical enum (kasia-relay/src/lib/commands.mjs). String literals like
// 'send_kas', 'send_message' in sendCommandAsync calls are forbidden — use COMMAND_TYPES.
//
// Z21 真因 = broker enqueue type='send_kas', relay only 'transfer'. silent fall-through.
// 修法 = enum import + lint catches string literals.
function checkCommandEnum(filepath, content) {
  if (!/broker-(?:action-queue|intake-watcher|buy-handler|sell-handler|llm-agent|cancel-refund)\.js$|settler-router\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  // Match {type: 'literal'} or {type: "literal"} where literal is one of relay command types.
  // Allowed: COMMAND_TYPES.X, COMMAND_TYPE_SET, dynamic vars.
  const RELAY_LITERALS = ['handshake', 'send_message', 'publish_card', 'send_broadcast', 'transfer', 'split_utxo', 'send_kas'];
  const literalSet = new Set(RELAY_LITERALS);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;  // skip comments
    const code = line.replace(/\/\/.*$/, '');
    // capture {type: '...'} pattern
    const m = code.match(/type:\s*['"]([\w_]+)['"]/);
    if (m && literalSet.has(m[1])) {
      // 'send_kas' is the deprecated name — definite violation
      // others are valid command types but should use COMMAND_TYPES enum
      violations.push({
        rule: 'CommandEnum (Z21/Layer 5)',
        file: filepath,
        line: i + 1,
        msg: `relay command type '${m[1]}' as string literal — use COMMAND_TYPES.${m[1].toUpperCase()} from kasia-relay/src/lib/commands.mjs (Z21 防 silent fall-through)`,
      });
    }
  }
}

// R-NWT-2026-04-28 Bug-Z22 (Owner production 真撞): "真**真**真" stutter pattern leaked from
// dev-coord agent broadcast style INTO broker user-facing strings. Real users see broker DM
// replies containing "真**真**真**真 cancel" (Owner screenshot 04:33). Catastrophic UX —
// users who don't accept stutter / repetition fully reject the product.
// Scope: broker-*.js + conversations.js (broker reply path). Block 真[*]{2,} or [^a-zA-Z0-9]\*\*[^a-zA-Z0-9]
// inside string literals (return/preview_text/message:/enqueue payload). Allow in comments.
function checkBrokerStutter(filepath, content) {
  if (!/broker-(?:buy-handler|sell-handler|llm-agent|cancel-refund|intake-watcher|action-queue)\.js$/.test(filepath)
      && !/conversations\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // skip comments
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    // strip inline comments to avoid false positives
    const code = line.replace(/\/\/.*$/, '');
    // detect stutter inside string literals (single, double, backtick)
    if (/['"`][^'"`]*真\*{2,}真[^'"`]*['"`]/.test(code)) {
      violations.push({ rule: 'BrokerStutter (Z22)', file: filepath, line: i + 1, msg: '真**真 stutter pattern in user-facing string — Owner production 真撞, plain 中文 only' });
    }
  }
}

// ── R37 (T-J1-19f, Bug-Z24): broker-llm-agent.js 单 system message literal ──
// 真根因 (Bug-Z24 e8f8e064): R33 wire (commit 371e4ca62) 漏看 T-J1-19f inline comment,
// reintroduce 第二条 {role:'system'} stateLockAddendum. Qwen Jinja chat template 见
// 2 个 system message 直接返 500 Bad Request → broker LLM 60-120s timeout 全崩.
// J1 e8f8e064 修法: 把 stateLockAddendum merge 进单条 system message.
// 防 reintroduce: lint count {role:'system'} literal, > 1 → block commit.
// 三方 v2.2 convergence: dev-coord broadcast a874c0d8 (2026-04-28).
function checkR37(filepath, content) {
  if (!/broker-llm-agent\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;  // skip comments
    const code = line.replace(/\/\/.*$/, '');
    const re = /\{\s*role\s*:\s*['"]system['"]/g;
    while (re.exec(code) !== null) hits.push(i + 1);
  }
  if (hits.length > 1) {
    violations.push({
      rule: 'R37 (Bug-Z24/T-J1-19f)',
      file: filepath,
      line: hits[0],
      msg: `broker-llm-agent.js 含 ${hits.length} 个 {role:'system'} literal (lines ${hits.join(',')}) — Qwen Jinja 双 system msg → 500 Bad Request (Bug-Z24 真撞 + R33 reintroduce 教训). 必合并成 1 个 system msg (J1 e8f8e064 修法). 见 ANTI-PATTERNS R37 + QWEN-RULES Rule 12.`,
    });
  }
}

// ── 跑 ──
for (const fp of targets) {
  let content;
  try { content = read(fp); } catch { continue; }
  checkR9(fp, content);
  checkR11(fp, content);
  checkR6(fp, content);
  checkR19(fp, content);
  checkR33(fp, content);
  checkR33b(fp, content);
  checkR37(fp, content);
  checkBrokerStutter(fp, content);
  checkCommandEnum(fp, content);
}
checkR10();

// ── 报告 ──
if (violations.length === 0) {
  console.log(`[lint-kanet] ✓ ${targets.length} files clean`);
  process.exit(0);
}

const byRule = {};
for (const v of violations) (byRule[v.rule] ||= []).push(v);

console.log(`\n[lint-kanet] ✗ ${violations.length} violations across ${Object.keys(byRule).length} rules:\n`);
for (const [rule, vs] of Object.entries(byRule)) {
  console.log(`  ${rule}: ${vs.length} hit(s)`);
  for (const v of vs.slice(0, 5)) {
    console.log(`    ${path.relative(ROOT, v.file)}:${v.line}`);
    console.log(`      ${v.msg.slice(0, 200)}`);
  }
  if (vs.length > 5) console.log(`    ... ${vs.length - 5} more`);
}
console.log(`\n  See docs/ANTI-PATTERNS.md for context. Fix before commit.`);
process.exit(1);
