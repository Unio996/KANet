#!/usr/bin/env node
// resolver.mjs — 本地小型 HTTP 服务, 供开源纯静态结账页/配置页调用真正需要 kaspa-wasm 的操作
// (报价签名/验签、签名链验签、订单地址推导、构造 split/refund tx)。
//
// 🔴 为什么需要这个东西, 而不是"纯浏览器零依赖"(实现期如实发现, 设计稿未预见到这一层):
// 本仓 node_modules/kaspa-wasm 是 wasm-bindgen `--target nodejs` 产物(`require('util')`/
// `module.exports`, 真实读源码确认——非猜测), 不能直接在浏览器里跑(没有打包垫片, 也没有单独的
// web-target 构建可用)。checkout.js/config.js 因此把"需要 kaspa-wasm 的那几步"(验签、地址推导、
// 构造交易)委托给这个本机常驻小服务; 页面本身仍然是零后端依赖的静态 HTML+JS, 唯一的外部依赖是
// "同一台机器上跑着这个脚本"——不是"我们的服务器"(任何人在自己机器上 `node resolver.mjs` 即可,
// 不需要问我们、不需要账号), 只是没有做到"零 Node 进程"这个更严格的目标。这是本轮如实交付的范围
// 边界, 不是回避——真正做到浏览器原生需要单独打一个 wasm-bindgen web-target 的 kaspa-wasm 构建,
// 那是另一件独立的基础设施工作, 不在本轮范围内。
//
// 安全边界(如实标注, 不是默认关闭就等于没有风险): 只监听 127.0.0.1(不监听 0.0.0.0), 私钥只在
// 内存里用一次即弃(不落盘/不打日志), 但任何本机上能访问 127.0.0.1 的其他进程原则上也能连——
// 与本机运行的任何本地钱包/签名工具的信任边界相同, 不是本设计独有的新风险。

import { createServer } from 'node:http';
import * as SDK from '../commission-plan-sdk.mjs';
import * as kaspa from 'kaspa-wasm';

const PORT = Number(process.env.CHECKOUT_RESOLVER_PORT || 8787);
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
