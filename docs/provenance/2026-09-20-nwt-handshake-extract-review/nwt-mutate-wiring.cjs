// NWT 握手笔一接线变异(与 J2 的 M13-15 不同): 都改 relay.mjs 的注入接线, 跑单文件测试, 还原并核 sha256
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const ROOT = 'D:/kanet-nwt-cand/kasia-relay';
const F = ROOT + '/src/relay.mjs';
const orig = fs.readFileSync(F, 'utf8');
const sha0 = crypto.createHash('sha256').update(orig).digest('hex');
const CALL = "const doAcceptHandshake = createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl: CONSOLE_URL, localAddress });";
const R = (a, b) => s => { const n = s.split(a).length - 1; if (n !== 1) throw new Error('anchor matched ' + n + 'x: ' + a.slice(0, 50)); return s.replace(a, b); };
const M = [
  ['h1 sendKaspa 换成 custodialSendKaspa(另一个花钱函数, 已导入)', R('createHandshakeAcceptor({ acceptHandshake, sendKaspa,', 'createHandshakeAcceptor({ acceptHandshake, sendKaspa: custodialSendKaspa,')],
  ['h2 ingestHandshake / ingestTx 互换', R('log, ingestHandshake, ingestTx, consoleUrl', 'log, ingestHandshake: ingestTx, ingestTx: ingestHandshake, consoleUrl')],
  ['h3 每次调用新建 acceptor(内存去重 Set 每次清空)', R(CALL, 'const doAcceptHandshake = (p) => createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl: CONSOLE_URL, localAddress })(p);')],
  ['h4 localAddress 换成 CONSOLE_URL', R('consoleUrl: CONSOLE_URL, localAddress });', 'consoleUrl: CONSOLE_URL, localAddress: CONSOLE_URL });')],
  ['h5 consoleUrl 写死空串(静默关掉 DB 去重)', R('consoleUrl: CONSOLE_URL, localAddress });', "consoleUrl: '', localAddress });")],
  ['h6 log 换成 console.log(丢时间戳前缀)', R('fetch, log, ingestHandshake', 'fetch, log: console.log, ingestHandshake')],
  ['h7 acceptHandshake 换成 sendMessage 的别名(同文件已导入的另一函数)', R('createHandshakeAcceptor({ acceptHandshake, sendKaspa,', 'createHandshakeAcceptor({ acceptHandshake: sendMessage, sendKaspa,')],
];
const out = [];
for (const [n, fn] of M) {
  let m; try { m = fn(orig); } catch (e) { out.push('?? ' + n + ' :: ' + e.message); continue; }
  try {
    fs.writeFileSync(F, m);
    const r = cp.spawnSync(process.execPath, ['src/lib/handshake-accept.test.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    out.push((r.status === 0 ? 'SURVIVED ' : 'killed   ') + n + (r.status === 0 ? '' : '   (' + ((r.stdout || '').match(/\[FAIL\]/g) || []).length + ' FAIL)'));
  } finally { fs.writeFileSync(F, orig); }
}
console.log(out.join('\n'));
console.log('restored identical: ' + (sha0 === crypto.createHash('sha256').update(fs.readFileSync(F)).digest('hex')));
