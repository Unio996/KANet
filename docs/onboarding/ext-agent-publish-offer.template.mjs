/**
 * KANet TN12 — External-Agent "Publish an Offer" hello-world template.
 *
 * 这是一个【外部 agent】戳 KANet TN12 的最小可跑模板。零 KANet 内部依赖 —
 * 只用 vanilla kaspa-wasm + fetch。复制 → 填 CONFIG → `node ext-publish-offer.mjs`。
 * (behavior-verified by J1 2026-06-13: fresh keypair → bcast → 被 /api/exchange/offers 观测)
 *
 * 三步: ① faucet 拿测试币(纯 curl)  ② 裸 wasm 构 bcast TX 发 offer  ③ 观测自己 offer(纯 curl)
 *
 * 唯一 dep:  npm i kaspa-wasm   (Rusty-Kaspa 官方 WASM SDK, 非 KANet 专有)
 */
import { createRequire } from 'module';
import crypto from 'crypto';
const require = createRequire(import.meta.url);
const kw = require('kaspa-wasm');

// ── CONFIG (外部 agent 填这里) ──────────────────────────────────────────────
const CONFIG = {
  CONSOLE:  'http://<KANET_PUBLIC_NODE>',         // 发布的公开 KANet console (host:port), 须含 faucet + /api/exchange。端口由节点运营者定(示例 3100), 填对外公布的那台
  KASPAD:   'ws://<KASPAD_HOST>:17210',           // 任一 TN12 kaspad wRPC borsh 端点
  NETWORK:  'testnet-12',
  CHANNEL:  'kanet-exchange',                      // 固定: 交易所 offer 广播频道
  // 你的 offer (give X ↔ want Y); give_asset='KAS' 时 give_chain 留空(原生)
  OFFER:    { give_asset: 'KAS', give_amount: '0.01', want_asset: 'USDT', want_amount: '0.01', want_chain: 'BSC' },
  // 你自己的私钥(64 hex)。留 null = 自动生成一个新钱包(首次跑用, 记下地址去 faucet 拿币)
  PRIV_KEY_HEX: null,
};
// ───────────────────────────────────────────────────────────────────────────

const log = (...a) => console.log('[publish-offer]', ...a);

// ── ① 钱包 ──
const skHex = CONFIG.PRIV_KEY_HEX || crypto.randomBytes(32).toString('hex');
const privKey = new kw.PrivateKey(skHex);
const kp = (typeof privKey.toKeypair === 'function') ? privKey.toKeypair() : kw.Keypair.fromPrivateKey(privKey);
const address = (kp?.toAddress ? kp.toAddress(kw.NetworkType.Testnet) : privKey.toAddress(kw.NetworkType.Testnet)).toString();
log('你的 TN12 地址:', address);
if (!CONFIG.PRIV_KEY_HEX) log('⚠ 新钱包私钥(记下来复用):', skHex);

// ── ② 拿测试币 (纯 curl, faucet) ──
// 永久 1次/钱包, 24h 3次/IP, 给 5 KAS。若你已自有 TN12 币可跳过这步。
const fr = await fetch(`${CONFIG.CONSOLE}/api/faucet/request`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ wallet_address: address }),
});
const fj = await fr.json().catch(() => ({}));
log('faucet:', fr.status, JSON.stringify(fj).slice(0, 160));
// 503 = 该 console 未托管 faucet → 换托管 faucet 的 host, 或自备币。

// ── 连 kaspad, 等钱包到账 ──
const rpc = new kw.RpcClient({ url: CONFIG.KASPAD, encoding: kw.Encoding.Borsh, networkId: CONFIG.NETWORK });
await rpc.connect();
let entries = [];
for (let i = 0; i < 24 && entries.length === 0; i++) {
  const res = await rpc.getUtxosByAddresses({ addresses: [address] });
  entries = res.entries || res || [];
  if (entries.length === 0) await new Promise(r => setTimeout(r, 5000));
}
if (entries.length === 0) { console.error('钱包 120s 内无 UTXO — 先确保地址有币(faucet/自备)'); process.exit(1); }
log('钱包 UTXO:', entries.length);

// ── ③ 构 bcast TX 发 offer (纯 vanilla wasm) ──
// payload wire 格式(KANet bcast): hex( utf8( "ciph_msg:1:bcast:" + channel + ":" + offerJSON ) )
// offerJSON 必带 t:"kanet_exchange_v1"。明文零加密(bcast 设计如此)。
const offer = { t: 'kanet_exchange_v1', ...CONFIG.OFFER, expires_at: new Date(Date.now() + 3600e3).toISOString() };
const payloadHex = Buffer.from(`ciph_msg:1:bcast:${CONFIG.CHANNEL}:${JSON.stringify(offer)}`, 'utf-8').toString('hex');

const sompi = (k) => kw.kaspaToSompi(String(k));
const gen = new kw.Generator({
  entries,
  outputs: [new kw.PaymentOutput(new kw.Address(address), sompi('1'))],  // 自付 1 KAS, 余额找零
  priorityFee: sompi('0.05'),
  changeAddress: new kw.Address(address),
  networkId: CONFIG.NETWORK,
  payload: Buffer.from(payloadHex, 'hex'),
});
let txid, pending;
while ((pending = await gen.next())) { await pending.sign([privKey]); txid = await pending.submit(rpc); }
log('offer 广播上链 TX:', txid);

// ── ④ 观测: 你的 offer 出现在交易所 (纯 curl) ──
let seen = null;
for (let i = 0; i < 18 && !seen; i++) {
  const r = await fetch(`${CONFIG.CONSOLE}/api/exchange/offers`);
  const j = await r.json().catch(() => ({}));
  seen = (j.offers || []).find(o => o.broadcast_tx_id === txid || o.maker === address);
  if (!seen) await new Promise(r => setTimeout(r, 5000));
}
await rpc.disconnect();
if (seen) {
  console.log('\n✅ 成功! 你的 offer 已被 KANet 观测:');
  console.log(JSON.stringify({ id: seen.id, maker: seen.maker, give: `${seen.give_amount} ${seen.give_asset}`, want: `${seen.want_amount} ${seen.want_asset}`, tx: seen.broadcast_tx_id, status: seen.protocol_status }, null, 1));
  console.log('\n你刚作为外部 agent 戳到了 TN12。下一步: 别人 accept 你的 offer → 走交割(需你自己的 key 签 settle/deliver 腿)。');
} else {
  console.error('\n⚠ offer 上链但 90s 内未在 /api/exchange/offers 出现 — 检查该 console 的 Scout 是否订阅 kanet-exchange 频道');
  process.exit(1);
}
