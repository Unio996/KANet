// proto-signing-key-binding.test.mjs — Codex MUST-PROVE 签名前公钥断言(Bettor 前置①)的正反回归。
// Run: cd kasia-console && node src/lib/proto-signing-key-binding.test.mjs
// 真 kaspa-wasm + 真编译 PoolSideTicket; 期望的 ticket spk 由测试自己按 ctor 编译+P2SH 得到(不经 computeTicketGenesisArtifact),
// 与被测的推导路径两侧不共用实现。

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_SIGNING_KEY_BINDING_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_signing_key_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_SIGNING_KEY_BINDING_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { randomBytes } = await import('node:crypto');
const { normalizePubkeyHex, pubkeyHexOfPrivkey, deriveTicketBettorPk, assertSigningKeyMatchesBinding, assertTicketSigningKey, deriveClaimWinnerPk, assertClaimWinnerSigningKey } = await import('./proto-signing-key-binding.mjs');
const { p2sh, computeMarketGenesisArtifacts, loadProtocolConstants } = await import('./proto-covenant-builder.mjs');
const { compileSilV100 } = await import('./pool-bshard-artifacts.mjs');
const { decryptCommitteePrivkey } = await import('./proto-committee-key.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };
const throws = (fn, re, secrets = []) => {
  let e = null; try { fn(); } catch (x) { e = x; }
  if (!e) throw new Error('应该throw, 却成功返回了');
  if (!re.test(e.message)) throw new Error(`throw了但报文不对: ${e.message}`);
  for (const s of secrets) if (s && e.message.includes(s)) throw new Error('错误信息泄露了私钥值');
};

const MARKET_ID = 'cd'.repeat(32);
const newKey = () => { const priv = randomBytes(32).toString('hex'); return { priv, pk: pubkeyHexOfPrivkey(kaspa, priv) }; };
const TICKET_PATH = new URL('./sil-v1/PoolSideTicket.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// 独立于被测代码: 测试自己编译 PoolSideTicket 并算 P2SH
const ticketSpk = ({ pk, side, stake }) => '0x' + p2sh(Buffer.from(compileSilV100(TICKET_PATH, [{ kind: 'bytes', value: [...Buffer.from(pk, 'hex')] }, { kind: 'int', value: side }, { kind: 'int', value: stake }, { kind: 'bytes', value: [...Buffer.from(MARKET_ID, 'hex')] }], 'PoolSideTicket').script));

const K1 = newKey(), K2 = newKey(), K3 = newKey();
const bet = { bettor_pk: K1.pk, side: 1, stake: 999 };
const onChainSpk = ticketSpk({ pk: K1.pk, side: 1, stake: 999 });

t('正向: 私钥的公钥 == 由 ticket 自身状态(proto_bets+链上spk)推导并证明的应签公钥 ⇒ 通过并返回公钥', () => {
  const pk = assertTicketSigningKey({ kaspa, privKeyHex: K1.priv, bet, marketId: MARKET_ID, ticketUtxoSpkHex: onChainSpk });
  if (pk !== K1.pk) throw new Error(`返回公钥 ${pk} != ${K1.pk}`);
});

t('正向: proto_bets.bettor_pk 是大写 hex(同一把公钥)按字节相等 ⇒ 通过(不做字符串大小写敏感比较)', () => {
  const upper = { ...bet, bettor_pk: K1.pk.toUpperCase() };
  assertTicketSigningKey({ kaspa, privKeyHex: K1.priv, bet: upper, marketId: MARKET_ID, ticketUtxoSpkHex: onChainSpk });
});

t('反向1: 手上是【别的私钥】(取错市场/取错 bettor 的私钥) ⇒ signing_key_mismatch, 在签名前 fail-closed, 错误信息不含私钥值', () => {
  throws(() => assertTicketSigningKey({ kaspa, privKeyHex: K2.priv, bet, marketId: MARKET_ID, ticketUtxoSpkHex: onChainSpk }), /signing_key_mismatch.*fail-closed/, [K1.priv, K2.priv]);
});

t('反向2: DB 里 bettor_pk 被换成别人的公钥(与链上 ticket 不是同一张票) ⇒ ticket_pk_underivable(推导不出, 不据此签名)', () => {
  throws(() => assertTicketSigningKey({ kaspa, privKeyHex: K3.priv, bet: { ...bet, bettor_pk: K3.pk }, marketId: MARKET_ID, ticketUtxoSpkHex: onChainSpk }), /ticket_pk_underivable/, [K3.priv]);
});

t('反向3: DB 里 stake/side 与链上 ticket 不符(998 vs 999 / side 0 vs 1) ⇒ ticket_pk_underivable', () => {
  throws(() => assertTicketSigningKey({ kaspa, privKeyHex: K1.priv, bet: { ...bet, stake: 998 }, marketId: MARKET_ID, ticketUtxoSpkHex: onChainSpk }), /ticket_pk_underivable/);
  throws(() => assertTicketSigningKey({ kaspa, privKeyHex: K1.priv, bet: { ...bet, side: 0 }, marketId: MARKET_ID, ticketUtxoSpkHex: onChainSpk }), /ticket_pk_underivable/);
});

t('反向4: 链上 ticket spk 缺失/畸形 ⇒ 拒绝; bettor_pk 不是 32 字节 hex ⇒ 拒绝', () => {
  throws(() => deriveTicketBettorPk({ bet, marketId: MARKET_ID, ticketUtxoSpkHex: undefined }), /ticket_pk_underivable/);
  throws(() => deriveTicketBettorPk({ bet: { ...bet, bettor_pk: K1.pk.slice(0, 62) }, marketId: MARKET_ID, ticketUtxoSpkHex: onChainSpk }), /32 字节 hex/);
  throws(() => normalizePubkeyHex('zz'.repeat(32)), /32 字节 hex/);
});

const gaA = await computeMarketGenesisArtifacts({ marketId: 'a1'.repeat(32), minBet: 1, deadlineMs: Date.now() + 3600_000 });
const gaB = await computeMarketGenesisArtifacts({ marketId: 'b2'.repeat(32), minBet: 1, deadlineMs: Date.now() + 3600_000 });
t('正向(生产路径 v0): 委员私钥解密后其公钥逐字节 == 本市场 committee 公钥(即 v0 里的 bettor_pk)', () => {
  const priv = decryptCommitteePrivkey(gaA.committeePrivkeyEnvelope);
  assertSigningKeyMatchesBinding({ kaspa, privKeyHex: priv, expectedPubkeyHex: gaA.committeePubkeyHex, label: 'v0 committee=bettor' });
});
t('反向(生产路径 v0): 取了【另一个市场】的委员私钥 ⇒ signing_key_mismatch(这正是"取错私钥"的实际场景)', () => {
  const privB = decryptCommitteePrivkey(gaB.committeePrivkeyEnvelope);
  throws(() => assertSigningKeyMatchesBinding({ kaspa, privKeyHex: privB, expectedPubkeyHex: gaA.committeePubkeyHex, label: 'v0 committee=bettor' }), /signing_key_mismatch/, [privB]);
});

// ── 批7 withdraw: KanetTokenClaim winner_pk 推导 + 签名前断言(期望 spk 由测试自己按 ctor 直接编译+P2SH, 不经 computeKanetTokenClaimGenesisArtifact) ──
const KTC_PATH = new URL('./KanetTokenClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { token_tmpl_hash: TOKEN_TMPL_HASH } = loadProtocolConstants();
const MARKET_COV = 'ef'.repeat(32);
const ktcSpk = ({ pk, amount }) => '0x' + p2sh(Buffer.from(compileSilV100(KTC_PATH, [{ kind: 'bytes', value: [...Buffer.from(MARKET_COV, 'hex')] }, { kind: 'bytes', value: [...Buffer.from(pk, 'hex')] }, { kind: 'int', value: amount }, { kind: 'bytes', value: [...Buffer.from(TOKEN_TMPL_HASH, 'hex')] }], 'KanetTokenClaim').script));
const kW = newKey(), kX = newKey();
t('withdraw 正向: winner_pk 与 (market_cov_id, amount) 重算的 KanetTokenClaim P2SH == 链上 spk ⇒ 推导出 winner_pk; 私钥公钥逐字节相等 ⇒ 放行(大写 hex 同一把也放行)', () => {
  const spk = ktcSpk({ pk: kW.pk, amount: 1000 });
  if (deriveClaimWinnerPk({ marketCovIdHex: MARKET_COV, winnerPkHex: kW.pk, amount: 1000, claimUtxoSpkHex: spk }) !== kW.pk) throw new Error('推导值不对');
  assertClaimWinnerSigningKey({ kaspa, privKeyHex: kW.priv, marketCovIdHex: MARKET_COV, winnerPkHex: kW.pk.toUpperCase(), amount: 1000, claimUtxoSpkHex: spk });
});
t('withdraw 反向①: 私钥是别人的(winner_pk 与链上 spk 自洽, 但私钥公钥不同) ⇒ signing_key_mismatch, 错误信息不含私钥', () => {
  throws(() => assertClaimWinnerSigningKey({ kaspa, privKeyHex: kX.priv, marketCovIdHex: MARKET_COV, winnerPkHex: kW.pk, amount: 1000, claimUtxoSpkHex: ktcSpk({ pk: kW.pk, amount: 1000 }) }), /signing_key_mismatch/, [kX.priv]);
});
t('withdraw 反向②: winner_pk / amount / market_cov_id 与链上 claim spk 不是同一个 ⇒ claim_pk_underivable(不据不自洽的输入推导应签公钥)', () => {
  const spk = ktcSpk({ pk: kW.pk, amount: 1000 });
  throws(() => deriveClaimWinnerPk({ marketCovIdHex: MARKET_COV, winnerPkHex: kX.pk, amount: 1000, claimUtxoSpkHex: spk }), /claim_pk_underivable/);
  throws(() => deriveClaimWinnerPk({ marketCovIdHex: MARKET_COV, winnerPkHex: kW.pk, amount: 999, claimUtxoSpkHex: spk }), /claim_pk_underivable/);
  throws(() => deriveClaimWinnerPk({ marketCovIdHex: '00'.repeat(32), winnerPkHex: kW.pk, amount: 1000, claimUtxoSpkHex: spk }), /claim_pk_underivable/);
  throws(() => deriveClaimWinnerPk({ marketCovIdHex: MARKET_COV, winnerPkHex: 'zz', amount: 1000, claimUtxoSpkHex: spk }), /32 字节 hex/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
