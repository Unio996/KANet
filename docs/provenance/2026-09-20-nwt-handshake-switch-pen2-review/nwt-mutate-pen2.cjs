// NWT 握手笔二(ff15de56)变异: 钱路(关闭态漏花钱 / 漏 claim)、启动崩溃(import 丢失)、开关语义、接线(H1-1)。
// 每个变异只改一个文件, 跑该分支的 5 份 relay 测试(单文件), 任一份非 0 退出 = 被抓。还原后核 sha256。
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const ROOT = 'D:/kanet-nwt-cand/kasia-relay';
const SRC = ROOT + '/src';
const F = { chain: SRC + '/chain.mjs', rpc: SRC + '/rpc-listener.mjs', relay: SRC + '/relay.mjs', acc: SRC + '/lib/handshake-accept.mjs', sw: SRC + '/lib/handshake-switch.mjs' };
const TESTS = ['src/lib/handshake-switch.test.mjs', 'src/lib/handshake-switch-scan.test.mjs', 'src/lib/handshake-accept.test.mjs', 'src/rpc-handshake-gate.test.mjs', 'src/handshake-chokepoint.test.mjs'];
const orig = {}, sha0 = {};
for (const [k, p] of Object.entries(F)) { orig[k] = fs.readFileSync(p, 'utf8'); sha0[k] = crypto.createHash('sha256').update(orig[k]).digest('hex'); }
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error('anchor matched ' + n + 'x: ' + a.slice(0, 70).replace(/\n/g, '\\n')); return s.replace(a, () => b); };
const CALL = "const doAcceptHandshake = createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl: CONSOLE_URL, localAddress });";
const GUARD_RPC = "    if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled — left pending for', senderAddress.slice(-12));\n      return;\n    }\n";
const M = [
  // ---- 钱路: chokepoint
  ['c1 [钱路] chokepoint 闸失效', 'chain', R("if (!handshakeAutoAcceptEnabled()) {\n    const peer = String(", "if (false) {\n    const peer = String(")],
  ['c2 [钱路] chokepoint 不 return null(落入取钱包构造草稿)', 'chain', R("    return null;\n  }\n  const wallet = getWallet();", "  }\n  const wallet = getWallet();")],
  ['c3 chokepoint import 丢失', 'chain', R("import { handshakeAutoAcceptEnabled, createOncePerKeyLogger } from './lib/handshake-switch.mjs';\n", "")],
  // ---- 钱路: 实时路径
  ['r1 [钱路] 实时落点关闭态不 return(继续 claim / accept / sendKaspa)', 'rpc', R("left pending for', senderAddress.slice(-12));\n      return;", "left pending for', senderAddress.slice(-12));")],
  ['r2 [钱路] 实时落点闸失效(if false)', 'rpc', R("if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled", "if (false) {\n      log('HANDSHAKE auto-accept disabled")],
  ['r3 [钱路] 实时落点闸挪到 claim 之后(关闭态仍会向 console claim)', 'rpc', (s) => { const a = R(GUARD_RPC, '')(s); return R("    log('HANDSHAKE step 5 claim ok');\n", GUARD_RPC + "    log('HANDSHAKE step 5 claim ok');\n")(a); }],
  ['r4 [钱路] 实时落点闸挪到 acceptHandshake 调用之后', 'rpc', (s) => { const a = R(GUARD_RPC, '')(s); return R("    if (draft?.payload) {\n      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });\n      log('HANDSHAKE ACCEPTED TX:', sent?.txId || sent, 'fee:', sent?.fee);", "    if (!handshakeAutoAcceptEnabled()) { return; }\n    if (draft?.payload) {\n      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });\n      log('HANDSHAKE ACCEPTED TX:', sent?.txId || sent, 'fee:', sent?.fee);")(a); }],
  // ---- 钱路: 追赶路径
  ['r5 [钱路] 追赶: else try 改成顺序 try(关闭态仍整段 claim/accept)', 'rpc', R("  } else try {\n    const hsParams", "  }\n  try {\n    const hsParams")],
  ['r6 [钱路] 追赶闸失效(if false)', 'rpc', R("if (!handshakeAutoAcceptEnabled()) {\n    handshakesDisabled = true;", "if (false) {\n    handshakesDisabled = true;")],
  ['r7 追赶汇总行关闭态仍写 handshakes 计数', 'rpc', R("${handshakesDisabled ? 'handshakes: DISABLED' : `${handshakeCount} handshakes accepted`}", "${`${handshakeCount} handshakes accepted`}")],
  // ---- 启动崩溃 / 启动行
  ['r8 [崩溃] rpc-listener import 丢失(关闭态调用 → ReferenceError)', 'rpc', R("import { handshakeAutoAcceptEnabled } from './lib/handshake-switch.mjs';\n", "")],
  ['l1 [崩溃] relay.mjs 启动行 import 丢失(relay 启动即 ReferenceError)', 'relay', R("import { handshakeStartupLine } from './lib/handshake-switch.mjs';\n", "")],
  ['l2 relay.mjs 启动行删除', 'relay', R("log(handshakeStartupLine(process.env, RELAY_MODE));\n", "")],
  ['l3 relay.mjs 启动行挪进 rpc 分支(indexer/回落模式不打)', 'relay', R("log(handshakeStartupLine(process.env, RELAY_MODE));\n\nif (RELAY_MODE === \"rpc\") {", "if (RELAY_MODE === \"rpc\") {\n  log(handshakeStartupLine(process.env, RELAY_MODE));")],
  ['l4 relay.mjs 启动行只读 process.env.RELAY_HANDSHAKE_AUTO_ACCEPT 字面(不经 handshakeStartupLine 的判定)', 'relay', R("log(handshakeStartupLine(process.env, RELAY_MODE));", "log(`handshake auto-accept: ${process.env.RELAY_HANDSHAKE_AUTO_ACCEPT ? 'ENABLED' : 'DISABLED'} (RELAY_MODE=${RELAY_MODE})`);")],
  // ---- 钱路: 轮询落点
  ['a1 [钱路] 轮询落点闸失效', 'acc', R("if (!handshakeAutoAcceptEnabled()) {\n      logDisabledOnce(", "if (false) {\n      logDisabledOnce(")],
  ['a2 [钱路] 轮询落点关闭态不 return', 'acc', R("left pending for ${peer.slice(-12)}`);\n      return;", "left pending for ${peer.slice(-12)}`);")],
  // ---- 开关语义
  ['s1 开关用宽松相等 == 1', 'sw', R("=== '1';\n}", "== 1;\n}")],
  ['s2 开关读值被缓存成模块常量', 'sw', R("export function handshakeAutoAcceptEnabled(env = process.env) {\n  return env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';", "const _ON = process.env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';\nexport function handshakeAutoAcceptEnabled(env = process.env) {\n  return env === process.env ? _ON : env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';")],
  ['s3 开关默认参数删掉(不带参调用 env 为 undefined)', 'sw', R("handshakeAutoAcceptEnabled(env = process.env) {", "handshakeAutoAcceptEnabled(env) {")],
  ['s4 去重 Set 无上限', 'sw', R("if (seen.size >= cap) {", "if (false) {")],
  ['s5 开关"非 0 即开"', 'sw', R("return env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';", "return env.RELAY_HANDSHAKE_AUTO_ACCEPT !== undefined && env.RELAY_HANDSHAKE_AUTO_ACCEPT !== '0';")],
  // ---- H1-1 接线(我笔一审的 6 个 + 补 1 个): 改 relay.mjs 的工厂调用行
  ['w1 [接线] sendKaspa 换成 custodialSendKaspa', 'relay', R("createHandshakeAcceptor({ acceptHandshake, sendKaspa,", "createHandshakeAcceptor({ acceptHandshake, sendKaspa: custodialSendKaspa,")],
  ['w2 [接线] ingestHandshake / ingestTx 互换', 'relay', R("log, ingestHandshake, ingestTx, consoleUrl", "log, ingestHandshake: ingestTx, ingestTx: ingestHandshake, consoleUrl")],
  ['w3 [接线] 每次调用新建 acceptor(去重 Set 每次清空)', 'relay', R(CALL, "const doAcceptHandshake = (p) => createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl: CONSOLE_URL, localAddress })(p);")],
  ['w4 [接线] localAddress 换成 CONSOLE_URL', 'relay', R("consoleUrl: CONSOLE_URL, localAddress });", "consoleUrl: CONSOLE_URL, localAddress: CONSOLE_URL });")],
  ['w5 [接线] log 换成 console.log', 'relay', R("fetch, log, ingestHandshake", "fetch, log: console.log, ingestHandshake")],
  ['w6 [接线] acceptHandshake 换成 sendMessage', 'relay', R("createHandshakeAcceptor({ acceptHandshake, sendKaspa,", "createHandshakeAcceptor({ acceptHandshake: sendMessage, sendKaspa,")],
  ['w7 [接线] acceptHandshake 换成 initiateHandshake 风格的另一导入函数 custodialSendKaspa(值传入)', 'relay', R("createHandshakeAcceptor({ acceptHandshake, sendKaspa,", "createHandshakeAcceptor({ acceptHandshake: custodialSendKaspa, sendKaspa,")],
];
const out = [];
for (const [n, which, fn] of M) {
  let m; try { m = fn(orig[which]); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  try {
    fs.writeFileSync(F[which], m);
    let killedBy = null, nfail = 0;
    for (const t of TESTS) {
      const r = cp.spawnSync(process.execPath, [t], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
      if (r.status !== 0) { nfail++; if (!killedBy) killedBy = t.split('/').pop().replace('.test.mjs', ''); }
    }
    out.push((nfail ? 'killed   ' : 'SURVIVED ') + n + (nfail ? '   (by ' + killedBy + (nfail > 1 ? ' +' + (nfail - 1) : '') + ')' : ''));
  } finally { fs.writeFileSync(F[which], orig[which]); }
}
console.log(out.join('\n'));
let ok = true; for (const [k, p] of Object.entries(F)) if (crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') !== sha0[k]) { ok = false; console.log('NOT RESTORED: ' + k); }
console.log('restored identical: ' + ok);
