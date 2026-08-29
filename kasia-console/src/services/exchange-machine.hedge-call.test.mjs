// DEFECT1 (race 盘点, NWT CONFIRMED, Bettor ④) 源级向量: exchange-machine 里 executeHedge 的两处调用都用 (offerId, agentName, side, qty) 签名;
// 旧形 executeHedge(finalOffer) (1ea63f83, 传整行对象 ⇒ offerId.slice 抛被吞 ⇒ 静默不 hedge) 不得残留; hedge_enabled 门 (tpf:2200) 不动。
// 跑: cd kasia-console && node src/services/exchange-machine.hedge-call.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const EM = readFileSync(join(here, 'exchange-machine.js'), 'utf8');
const TPF = readFileSync(join(here, 'trade-protocol-filter.js'), 'utf8');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const CODE = EM.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // 去整行注释 (注释里引用旧形作说明, 不算残留)
t('D1 旧形 executeHedge(finalOffer) 不残留(代码行); 两处调用都是 executeHedge(finalOffer.id, localAgent.name, hedgeSide, hedgeQty)', () => {
  assert.ok(!/executeHedge\(finalOffer\)/.test(CODE), '旧形残留');
  const calls = EM.match(/executeHedge\(finalOffer\.id, localAgent\.name, hedgeSide, hedgeQty\)/g) || [];
  assert.strictEqual(calls.length, 2, `正确调法应 2 处, 实 ${calls.length}`);
});
t('D2 签名一致: tpf _executeHedge(offerId, agentName, side, qty, …) 首参是 id 字符串 (第一句就 .slice / SELECT … WHERE id = ?)', () => {
  const m = TPF.match(/async function _executeHedge\(offerId, agentName, side, qty[^)]*\)/); assert.ok(m, '签名变了, 本向量与调用处需同步重钉');
  const body = TPF.slice(TPF.indexOf(m[0]), TPF.indexOf(m[0]) + 1500);
  assert.ok(/hedge_enabled !== true/.test(body), 'hedge_enabled 门须仍在 (未开 flag 的 offer 行为不变)');
});
t('D3 修后分支: makerGaveKas ⇒ BUY/give_amount, 否则 SELL/want_amount; hedgeQty>0 才调 (镜像 :1140-1144)', () => {
  const blk = EM.slice(EM.indexOf('BUY kaspa_tx verified → completed'), EM.indexOf('BUY kaspa_tx verified → completed') + 1600);
  assert.ok(/const makerGaveKas = finalOffer\.give_asset === 'KAS'/.test(blk) && /hedgeSide = makerGaveKas \? 'BUY' : 'SELL'/.test(blk) && /if \(hedgeQty > 0\)/.test(blk));
});
t('D4 传对象必抛 (钉住旧形为什么静默): 模拟 offerId.slice 对对象 ⇒ TypeError', () => { assert.throws(() => ({}).slice(0, 8), TypeError); });
console.log(`hedge-call: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
