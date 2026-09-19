// 录下抽取前 doAcceptHandshake 在各条路径上【真实查找】的外部标识符, 对照工厂注入的 8 个名字
const fs = require('fs');
const rel = fs.readFileSync('f5x_before_relay.mjs', 'utf8').replace(/\r\n/g, '\n');
const s = rel.indexOf('const _acceptedPeers = new Set()');
const e = rel.indexOf('async function poll()');
const orig = rel.slice(s, e);
const seen = new Set();
function run(script) {
  const sb = new Proxy({}, {
    has: (_, k) => { if (typeof k === 'string') seen.add(k); return typeof k === 'string' && !['Set', 'encodeURIComponent', 'Date', 'Error', 'JSON', 'Promise', 'undefined', 'Symbol'].includes(k); },
    get: (_, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k === 'CONSOLE_URL') return script.consoleUrl;
      if (k === 'localAddress') return 'LOCAL';
      if (k === 'fetch') return async () => ({ json: async () => script.rs });
      if (k === 'acceptHandshake') return async () => script.draft;
      if (k === 'sendKaspa') return async () => script.sent;
      return () => {};
    },
  });
  const fn = new Function('sb', 'with (sb) {' + orig + '\nreturn doAcceptHandshake; }');
  return fn(sb);
}
(async () => {
  const scripts = [
    { consoleUrl: 'http://x', rs: { status: 'accepted' }, draft: { payload: 'p', to: 't', amount: 1 }, sent: { txId: 'a', fee: 1 } },
    { consoleUrl: 'http://x', rs: { status: 'none' }, draft: { payload: 'p', to: 't', amount: 1 }, sent: { txId: 'a', fee: 1 } },
    { consoleUrl: '', rs: {}, draft: null, sent: null },
    { consoleUrl: '', rs: {}, draft: { payload: 'p', to: 't', amount: 1 }, sent: { txId: 'a', fee: 1 } },
  ];
  for (const sc of scripts) { const f = run(sc); await f('kaspa:qpeer0000000000000000000000000000000000000000000000000000'); await f('kaspa:qpeer0000000000000000000000000000000000000000000000000000'); }
  console.log('looked-up external names:', [...seen].sort().join(', '));
  const injected = ['acceptHandshake', 'sendKaspa', 'fetch', 'log', 'ingestHandshake', 'ingestTx', 'CONSOLE_URL', 'localAddress'];
  const builtins = ['Set', 'encodeURIComponent', 'Date', 'Error', 'JSON', 'Promise', 'undefined', 'Symbol'];
  const missing = [...seen].filter(n => !injected.includes(n) && !builtins.includes(n) && n !== '_acceptedPeers' && n !== 'doAcceptHandshake');
  console.log('looked up but NOT injected (should be empty):', JSON.stringify(missing));
  console.log('injected but never looked up:', JSON.stringify(injected.filter(n => !seen.has(n))));
})();
