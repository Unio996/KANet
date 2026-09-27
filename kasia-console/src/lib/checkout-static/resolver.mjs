#!/usr/bin/env node
// resolver.mjs — 本地小型 HTTP 服务, 供开源纯静态结账页/配置页调用仍然需要 kaspa-wasm(Node 版)
// 的少数操作(订单地址推导、构造/广播 split/refund tx、报价签名)。
//
// 🔴 状态更新(D-034 §8 SHOULD③ 落地后, 2026-09-27): 报价验签/签名链验证/渠道地址去重上限三步
// 已经**不再**经过本文件——`checkout.js` 直接用浏览器原生 wasm(`build-web --sdk` 产物, 见
// vendor/kaspa-web/)在客户端完成, 见该目录 README。本文件现在唯一存在的理由是: 订单地址推导
// (`createCommissionSplitProtocol`)依赖 `silverc.exe`(独立原生编译器, 与 kaspa-wasm 编译成什么
// target 完全无关, 没有浏览器版本), 以及实际广播交易需要连节点 RPC。仍然不是"我们的服务器"
// (任何人在自己机器上 `node resolver.mjs` 即可, 不需要问我们、不需要账号)。
//
// 安全边界(如实标注, 不是默认关闭就等于没有风险): 只监听 127.0.0.1(不监听 0.0.0.0), 私钥只在
// 内存里用一次即弃(不落盘/不打日志), 但任何本机上能访问 127.0.0.1 的其他进程原则上也能连——
// 与本机运行的任何本地钱包/签名工具的信任边界相同, 不是本设计独有的新风险。

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import * as SDK from '../commission-plan-sdk.mjs';
import * as kaspa from 'kaspa-wasm';
import { assertWasmPinned } from './wasm-pin-check.mjs';

const PORT = Number(process.env.CHECKOUT_RESOLVER_PORT || 8787);

// 启动期锁版本校验(D-034 §8 后续票②, 同 D-019 pin 纪律)——只核浏览器版 wasm 是否真的部署到位、
// sha256 是否与 scripts/kaspa-wasm-web-pin.json 一致; 这是"操作者自查", 不是本文件运行时会真的
// 加载这份 wasm(它加载的是 Node 版 npm kaspa-wasm)。核不过只 warn 不 throw(缺 vendor 目录不该
// 拦住 resolver.mjs 本身该做的事——订单地址推导/广播——那部分不依赖浏览器 wasm)。
const vendorWasmPath = new URL('./vendor/kaspa-web/kaspa_bg.wasm', import.meta.url);
if (existsSync(vendorWasmPath)) {
  try { assertWasmPinned(vendorWasmPath.pathname.replace(/^\/([A-Za-z]):/, '$1:')); }
  catch (e) { console.warn(`[resolver] ⚠ ${e.message}`); }
} else {
  console.warn('[resolver] ⚠ vendor/kaspa-web/kaspa_bg.wasm 未部署——checkout.js 的浏览器原生验证步骤会失败, 见 vendor/kaspa-web/README.md');
}
const rpcCache = new Map(); // url -> connected RpcClient(复用连接, 不必每个请求重连)
async function getRpc(url, networkId) {
  const key = `${url}|${networkId}`;
  if (rpcCache.has(key)) return rpcCache.get(key);
  const rpc = new kaspa.RpcClient({ url, encoding: kaspa.Encoding.Borsh, networkId });
  await rpc.connect({});
  rpcCache.set(key, rpc);
  return rpc;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function hexToBuf(h) { return Buffer.from(h, 'hex'); }
function bufToHex(b) { return Buffer.from(b).toString('hex'); }

const ROUTES = {
  async '/verify-quote'(body) {
    return { ok: SDK.verifyQuoteSignature(body.quote) };
  },
  async '/verify-chain'(body) {
    const entries = (body.entries || []).map(e => ({ position: e.position, address_spk: hexToBuf(e.address_spk_hex), signing_pubkey: hexToBuf(e.signing_pubkey_hex), sig: e.sig_hex }));
    const r = SDK.verifyChain(body.quote, entries, body.network);
    return { ok: r.ok, reason: r.reason, chainDigestHex: r.ok ? bufToHex(r.chainDigest) : null, channelSpksHex: r.ok ? r.channelSpks.map(bufToHex) : [] };
  },
  async '/dedup-cap'(body) {
    const r = SDK.dedupAndCapChannelSpks(body.rawAddrs || []);
    return { ok: r.ok, reason: r.reason, spksHex: r.ok ? r.spks.map(s => s ? bufToHex(s) : null) : [] };
  },
  async '/resolve-order'(body) {
    // body: { quote, verifiedChain:{ok,channelSpksHex}, network }
    const verifiedChain = { ok: body.verifiedChain.ok, channelSpks: (body.verifiedChain.channelSpksHex || []).map(h => h ? hexToBuf(h) : null) };
    const resolved = SDK.resolveRulesForOrder(body.quote, verifiedChain);
    const finalRoles = resolved.payoutLeaves.map(r => ({ amountSompi: r.amountSompi, spk: r.spk }));
    const protocol = SDK.createCommissionSplitProtocol({
      network: body.network,
      finalRoles,
      payerRefundAddress: body.payerRefundAddress,
      deadlineMs: Date.now() + Number(body.quote.deadline_offset_ms || SDK.DEFAULT_DEADLINE_MS),
      maxSplitFeeSompi: BigInt(body.quote.max_split_fee_sompi),
      maxRefundFeeSompi: BigInt(body.quote.max_refund_fee_sompi),
    });
    return {
      address: protocol.address, deadlineMs: protocol.deadlineMs,
      roles: resolved.payoutLeaves.map(r => ({ name: r.name, amountSompi: r.amountSompi.toString(), spkHex: bufToHex(r.spk) })),
    };
  },
  async '/sign-quote'(body) {
    const priv = new kaspa.PrivateKey(body.merchantPrivKeyHex);
    const quoteWithPk = { ...body.quote, merchant_pubkey_hex: body.quote.merchant_pubkey_hex || priv.toPublicKey().toString() };
    const signed = SDK.signQuote(quoteWithPk, body.merchantPrivKeyHex);
    return { quote: signed };
  },
  async '/payment-status'(body) {
    const rpc = await getRpc(body.rpcUrl, body.network);
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [body.orderAddress] });
    const total = (entries || []).reduce((a, e) => a + BigInt(e.entry?.amount ?? e.amount ?? 0), 0n);
    return { paid: total > 0n, totalSompi: total.toString(), utxoCount: (entries || []).length };
  },
  async '/build-and-broadcast-split'(body) {
    const rpc = await getRpc(body.rpcUrl, body.network);
    const finalRoles = body.roles.map(r => ({ amountSompi: BigInt(r.amountSompi), spk: hexToBuf(r.spkHex) }));
    const protocol = SDK.createCommissionSplitProtocol({
      network: body.network, finalRoles, payerRefundAddress: body.payerRefundAddress,
      deadlineMs: body.deadlineMs, maxSplitFeeSompi: BigInt(body.maxSplitFeeSompi), maxRefundFeeSompi: BigInt(body.maxRefundFeeSompi),
    });
    if (protocol.address !== body.expectedOrderAddress) return { error: `地址不一致: 复算=${protocol.address} 期望=${body.expectedOrderAddress}` };
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [protocol.address] });
    if (!entries || !entries.length) return { error: '未查到订单地址的资金 UTXO' };
    const e = entries[0];
    const utxo = { transactionId: e.outpoint.transactionId, index: e.outpoint.index, amountSompi: e.entry?.amount ?? e.amount };
    const { tx } = SDK.buildCommissionSplitTx(protocol, utxo);
    const result = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
    return { transactionId: result.transactionId };
  },
  async '/build-and-broadcast-refund'(body) {
    const rpc = await getRpc(body.rpcUrl, body.network);
    const finalRoles = body.roles.map(r => ({ amountSompi: BigInt(r.amountSompi), spk: hexToBuf(r.spkHex) }));
    const protocol = SDK.createCommissionSplitProtocol({
      network: body.network, finalRoles, payerRefundAddress: body.payerRefundAddress,
      deadlineMs: body.deadlineMs, maxSplitFeeSompi: BigInt(body.maxSplitFeeSompi), maxRefundFeeSompi: BigInt(body.maxRefundFeeSompi),
    });
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [protocol.address] });
    if (!entries || !entries.length) return { error: '未查到订单地址的资金 UTXO' };
    const e = entries[0];
    const utxo = { transactionId: e.outpoint.transactionId, index: e.outpoint.index, amountSompi: e.entry?.amount ?? e.amount };
    const bdi = await rpc.getBlockDagInfo();
    const { tx } = SDK.buildCommissionRefundTx(protocol, utxo, Number(bdi.pastMedianTime), 5000);
    const result = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
    return { transactionId: result.transactionId };
  },
};

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const handler = ROUTES[req.url];
  if (!handler) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
  try {
    const body = await readBody(req);
    const result = await handler(body);
    res.writeHead(200);
    res.end(JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v));
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[checkout-resolver] listening on http://127.0.0.1:${PORT} (loopback only)`);
});
