// delivery-read-kaspa-api.mjs — 账本1877 步3: ReadBackend 的 api.kaspa.org 真适配器(设计 v0.3 §1; spike #1 实测: 返回 payload、CORS *, 按地址列交易历史)。
//   接口(买家页与 watcher 共用同一契约):  listAddressTxs(address) → { txs:[{txid,isAccepted,acceptingBlueScore,blockTimeMs,outputs:[{index,valueSompi,address}],spentOutpoints:[{txid,index}],payloadHex}], currentBlueScore }
//   fail-closed: 非 200 / 非 JSON / 关键字段缺失或类型不对 ⇒ 抛(调用方 tick 保持原状态), 绝不把"读不到"当成"没有交易"。读服务只可能拒绝或重放, 不能伪造(AEAD/订单 ctor 校验在上层), 但"空列表"会让 watcher 误判"没付款"之外无害。
//   fetch 注入(测试/浏览器/Node 同一实现); 只发 GET, 无自定义头(simple request ⇒ 浏览器无预检)。
const DEFAULT_BASE = 'https://api.kaspa.org';
const HEX64 = /^[0-9a-f]{64}$/;

export function makeKaspaApiReader({ baseUrl = DEFAULT_BASE, fetchImpl = globalThis.fetch, timeoutMs = 8000, pageLimit = 50, maxPages = 10 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('delivery-read-kaspa-api: 需要 fetch');
  const base = String(baseUrl).replace(/\/$/, '');
  const getJson = async (path) => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await fetchImpl(base + path, ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) throw new Error(`读后端 ${path.split('?')[0]} 返回 HTTP ${r.status}`);
      let j; try { j = await r.json(); } catch { throw new Error(`读后端 ${path.split('?')[0]} 返回非 JSON`); }
      return j;
    } finally { if (timer) clearTimeout(timer); }
  };

  function normTx(t) {
    if (!t || typeof t !== 'object' || !HEX64.test(String(t.transaction_id || ''))) throw new Error('读后端: 交易缺 transaction_id');
    if (!Array.isArray(t.outputs) || !Array.isArray(t.inputs)) throw new Error('读后端: 交易缺 inputs/outputs');
    if (typeof t.is_accepted !== 'boolean') throw new Error('读后端: 交易缺 is_accepted');
    const outputs = t.outputs.map((o) => {
      const v = o.amount; if (!(Number.isSafeInteger(v) || (typeof v === 'string' && /^[0-9]+$/.test(v))) || !Number.isInteger(o.index)) throw new Error('读后端: 输出缺 amount/index');
      return { index: o.index, valueSompi: String(v), address: String(o.script_public_key_address || '') };
    });
    const spentOutpoints = t.inputs.map((i) => { if (!HEX64.test(String(i.previous_outpoint_hash || ''))) throw new Error('读后端: 输入缺 previous_outpoint_hash'); return { txid: String(i.previous_outpoint_hash), index: Number(i.previous_outpoint_index) }; });
    const payloadHex = typeof t.payload === 'string' && t.payload.length ? t.payload.toLowerCase() : undefined;
    const bs = t.accepting_block_blue_score;
    return { txid: t.transaction_id, isAccepted: t.is_accepted, acceptingBlueScore: t.is_accepted && Number.isFinite(Number(bs)) ? Number(bs) : NaN, blockTimeMs: Number(t.block_time), outputs, spentOutpoints, payloadHex };
  }

  async function currentBlueScore() {
    const j = await getJson('/info/virtual-chain-blue-score');
    const n = Number(j?.blueScore); if (!Number.isFinite(n) || n <= 0) throw new Error('读后端: blueScore 非法'); return n;
  }

  async function listAddressTxs(address) {
    if (typeof address !== 'string' || !/^[a-z]+:[a-z0-9]{20,}$/.test(address)) throw new Error('listAddressTxs: 地址非法');
    const txs = [];
    for (let page = 0; page < maxPages; page++) {
      const arr = await getJson(`/addresses/${address}/full-transactions?limit=${pageLimit}&offset=${page * pageLimit}&resolve_previous_outpoints=no`);
      if (!Array.isArray(arr)) throw new Error('读后端: full-transactions 不是数组');
      for (const t of arr) txs.push(normTx(t));
      if (arr.length < pageLimit) break;
    }
    return { txs, currentBlueScore: await currentBlueScore() };
  }
  return { listAddressTxs, currentBlueScore };
}

/** 浏览器入口: 主网固定官方读后端; 非主网允许页面 ?api= 覆盖(simnet/测试用; 主网一律忽略, 防构造链接把页面指向恶意读服务)。 */
export function makeKaspaApiReaderBrowser(network, apiOverride) {
  return makeKaspaApiReader({ baseUrl: network === 'mainnet' || !apiOverride ? DEFAULT_BASE : apiOverride, fetchImpl: (...a) => globalThis.fetch(...a) });
}
