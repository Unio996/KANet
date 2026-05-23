# TASK — across-bridge 扫尾清单

> 审查方：Opus 4.7（qclaude 壳）
> 执行方：QClaude
> 前置：`kasia-console/src/services/across-bridge.js` + `across-bridge-config.js` 已存在，13 个初审 bug 修完 9 个，遗留 4 个新坑
> 目标：修完能跑的 `/api/relay/:id/wallets/:walletId/bridge` endpoint，$54.34 Arbitrum USDC → Polygon `0x9E13…1a50`

---

## 🔴 3 个必修 bug（不修就 crash）

### [必修 1] Polygon SpokePool 地址 checksum 错

**文件**：`kasia-console/src/services/across-bridge-config.js:13`

```diff
- polygon: '0x9295ee1d8C5b022BE115A2AD3c30C72E34e7F096',
+ polygon: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
```

**原因**：第 15 字节 `BE`（大）vs `Be`（小）。ethers 的 `getAddress()` 校验 EIP-55 checksum 会直接抛 `bad address checksum`。

**验证**：
```bash
node -e "const {ethers}=require('ethers'); console.log(ethers.getAddress('0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096'))"
# 应原样返回，不 throw
```

---

### [必修 2] quoteBridge URL 缺 `allowUnmatchedDecimals=true`

**文件**：`kasia-console/src/services/across-bridge-config.js:44-49`

**原因**：BSC USDC 是 18 decimals，其他链 6 decimals。Across API 默认拒绝 decimals mismatch，返回 `INVALID_PARAM / Decimals of input and output tokens do not match`。这正是 T1.3 失败的真因（不是"不支持 BSC"，BSC 在 `available-routes` 里有 128 条路由）。

```diff
  const url = `https://app.across.to/api/suggested-fees`
    + `?inputToken=${cfg.USDC[fromChain]}`
    + `&outputToken=${cfg.USDC[toChain]}`
    + `&originChainId=${cfg.CHAIN_IDS[fromChain]}`
    + `&destinationChainId=${cfg.CHAIN_IDS[toChain]}`
-   + `&amount=${amount}`;
+   + `&amount=${amount}`
+   + `&allowUnmatchedDecimals=true`;
```

**为什么一直加**：即使同链 decimals 对得上（arb→polygon 都是 6），加这个 flag 也无害。未来新链入列时天然兼容。

**验证**：
```bash
# T1.3 retest
curl -s 'https://app.across.to/api/suggested-fees?inputToken=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d&outputToken=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359&originChainId=56&destinationChainId=137&amount=10000000000000000000&allowUnmatchedDecimals=true' | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const d=JSON.parse(s);console.log('outputAmount:',d.outputAmount,'timestamp:',d.timestamp,'fillDeadline:',d.fillDeadline);});"
# 应返回正常 quote，不是 400 error
```

---

### [必修 3] RPC fallback 选错函数（Bug 9 半修）

**文件**：`kasia-console/src/services/across-bridge.js:10, 71, 85`

**原因**：`chains.js` 有两个函数：
- `withProvider(rpcUrl, fn)` — 单 URL + provider cleanup，**无 fallback**
- `withFallbackRpc(chain, fn)` — 按 `rpcPool` 顺序自动降级

QClaude 选了前者。`rpcPool[0]` 挂了整个 flow 挂。应改成后者（签名第一个参数是**链名**，不是 URL）。

**改动**：

```diff
- import { withProvider } from './chains.js';
+ import { withFallbackRpc } from './chains.js';
```

**line 67-79（L2 gas check 块）**：
```diff
  if (L2_CHAINS.includes(fromChain)) {
    const meta = CHAIN_META[fromChain];
    if (!meta) throw new Error(`Chain meta missing: ${fromChain}`);
-   const bal = await withProvider(meta.rpcPool[0], async (p) => {
-     return p.getBalance(new ethers.Wallet(privateKey).address);
-   });
+   const bal = await withFallbackRpc(fromChain, async (p) => {
+     return p.getBalance(new ethers.Wallet(privateKey).address);
+   });
    if (bal < ethers.parseEther('0.0001')) {
      throw new Error(
        `Insufficient ${meta.nativeSymbol} for gas on ${fromChain}. Need >0.0001 ${meta.nativeSymbol}.`
      );
    }
  }
```

**line 85-86（主 deposit 块）**：
```diff
- return withProvider(CHAIN_META[fromChain]?.rpcPool[0] || 'https://rpc.ankr.com/' + fromChain,
-   async (provider) => {
+ const meta = CHAIN_META[fromChain];
+ if (!meta?.rpcPool?.length) throw new Error(`No RPC configured for ${fromChain}`);
+ return withFallbackRpc(fromChain, async (provider) => {
```

**同时把 Bug E 的危险兜底 URL 一并干掉**（`'https://rpc.ankr.com/' + fromChain` 拼出来的很可能不是有效 URL，比如 `bnb` 拼出来 `rpc.ankr.com/bnb` 但 Ankr 的 BSC endpoint 是 `/bsc`——错的 URL 比 fast-fail 更糟）。

---

## 🧹 1 个清理

### [清理 4] 删掉 dead import（Bug 10 真修）

**文件**：`kasia-console/src/services/across-bridge-config.js:9`

```diff
- import { EVM_RPC_URLS, CHAIN_META, withFallbackRpc } from './chains.js';
+ import { EVM_RPC_URLS, CHAIN_META } from './chains.js';
```

`withFallbackRpc` 在 config.js 里从没使用。bridge.js 是直接从 `chains.js` import 的，不经过 config.js。

---

## 🟢 加 endpoint

### [endpoint] POST /api/relay/:id/wallets/:walletId/bridge

**文件**：`kasia-console/src/api/relay.js`（末尾，紧跟 `/swap` endpoint 之后）

**参照**：`/swap` endpoint（line 826-923）的骨架风格，但用 `executeBridge` 而非 Uniswap V3。

```js
// POST /api/relay/:id/wallets/:walletId/bridge — cross-chain USDC via Across V3
fastify.post('/api/relay/:id/wallets/:walletId/bridge', async (request, reply) => {
  const relay = getRelayNode(request.params.id);
  if (!relay) return reply.code(404).send({ error: 'Relay not found' });

  const wallet = sqlite.prepare(
    'SELECT id, chain, address, privkey_encrypted FROM agent_wallets WHERE id = ? AND relay_node_id = ?'
  ).get(request.params.walletId, request.params.id);
  if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
  if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key' });

  const { toChain, amount, recipient } = request.body || {};
  const SUPPORTED = ['arbitrum', 'polygon', 'bnb', 'eth', 'base', 'optimism'];
  if (!SUPPORTED.includes(wallet.chain))
    return reply.code(400).send({ error: `bridge source not supported: ${wallet.chain}` });
  if (!SUPPORTED.includes(toChain))
    return reply.code(400).send({ error: `bridge dest not supported: ${toChain}` });
  if (wallet.chain === toChain)
    return reply.code(400).send({ error: 'Same chain, use /swap instead' });
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return reply.code(400).send({ error: 'amount required (positive number)' });
  if (recipient && !/^0x[a-fA-F0-9]{40}$/.test(recipient))
    return reply.code(400).send({ error: 'recipient must be a 0x-prefixed EVM address' });

  try {
    const privateKey = decrypt(wallet.privkey_encrypted);
    const { executeBridge } = await import('../services/across-bridge.js');
    const result = await executeBridge(
      privateKey, wallet.chain, toChain, parseFloat(amount), recipient || wallet.address
    );
    recordChainEvent({
      txid: result.txHash,
      eventType: 'bridge_deposit',
      fromAddress: wallet.address,
      toAddress: recipient || wallet.address,
      payload: JSON.stringify({
        fromChain: wallet.chain,
        toChain,
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        fee: result.fee,
        block: result.block,
      }),
    });
    return reply.send(result);
  } catch (err) {
    console.error(`[bridge] Failed: ${err.message}`);
    return reply.code(500).send({ error: err.message });
  }
});
```

**`recordChainEvent` 参数格式已验证**（`chain-event.js:31`）：
- 驼峰参数（`txid, eventType, fromAddress, toAddress, payload, observedBy, observedAt`）自动映射到下划线列
- 现有 `defi.js` 里 10+ 处这样调用，无须改

---

## 🧪 回归测试 — 必须全绿才能报完成

### Gate 1：静态（修完立即跑，不花钱）

```bash
cd /c/kanet/kasia-console

# G1.1 — import 健康
node -e "import('./src/services/across-bridge.js').then(()=>console.log('OK')).catch(e=>{console.error('FAIL:',e.message);process.exit(1)})"

# G1.2 — 全部地址硬验证 + checksum drift
node -e "
const {ethers} = require('ethers');
import('./src/services/across-bridge-config.js').then(mod => {
  let fail = 0;
  for (const grp of ['SPOKE_POOLS', 'USDC']) {
    for (const [k, v] of Object.entries(mod[grp])) {
      try {
        const csum = ethers.getAddress(v);
        if (csum !== v) { console.error('  ✗ checksum drift', grp, k, '\n    file:    '+v+'\n    correct: '+csum); fail++; }
        else console.log('  ✓', grp, k);
      } catch (e) { console.error('  ✗ INVALID', grp, k, v, '→', e.shortMessage||e.message); fail++; }
    }
  }
  if (fail > 0) { console.error('G1.2 FAIL'); process.exit(1); }
  console.log('G1.2 ALL VALID');
});
"

# G1.3 — 没残留 dead import
! grep -nE "withFallbackRpc.*from.*chains" src/services/across-bridge-config.js || (echo 'FAIL: unused import still present' && exit 1)
```

### Gate 2：live quote（免费打 Across API）

```bash
# G2.1 — arb → polygon (both 6 decimals)
node -e "
import('./src/services/across-bridge-config.js').then(async m => {
  const q = await m.quoteBridge('arbitrum', 'polygon', 54.34);
  console.log('arb→poly quote:', JSON.stringify(q, null, 2));
  if (!q.outputAmount || !q.timestamp) { console.error('G2.1 FAIL'); process.exit(1); }
});
"

# G2.2 — bnb → polygon (18 vs 6 decimals, requires allowUnmatchedDecimals)
node -e "
import('./src/services/across-bridge-config.js').then(async m => {
  const q = await m.quoteBridge('bnb', 'polygon', 10);
  console.log('bnb→poly quote:', JSON.stringify(q, null, 2));
  if (!q.outputAmount) { console.error('G2.2 FAIL'); process.exit(1); }
});
"

# G2.3 — polygon → arb (reverse direction)
node -e "
import('./src/services/across-bridge-config.js').then(async m => {
  const q = await m.quoteBridge('polygon', 'arbitrum', 50);
  console.log('poly→arb quote:', JSON.stringify(q, null, 2));
  if (!q.outputAmount) { console.error('G2.3 FAIL'); process.exit(1); }
});
"
```

### Gate 3：endpoint live（Console 运行中打 HTTP）

```bash
# G3.1 — endpoint 注册成功
curl -s -o /dev/null -w '%{http_code}\n' -X POST 'http://127.0.0.1:3100/api/relay/c9c37c37-9a8c-484c-9893-20185d97ccf9/wallets/1eb8523a-071a-41c2-a16c-feaed020733b/bridge'
# 期望 400（body 空）而不是 404，证明路由存在

# G3.2 — 负路径：同链拒绝
curl -s -X POST 'http://127.0.0.1:3100/api/relay/c9c37c37-9a8c-484c-9893-20185d97ccf9/wallets/1eb8523a-071a-41c2-a16c-feaed020733b/bridge' \
  -H 'Content-Type: application/json' \
  -d '{"toChain":"arbitrum","amount":1}'
# 期望 {"error":"Same chain, use /swap instead"}

# G3.3 — 负路径：无效链
curl -s -X POST '...' -d '{"toChain":"kaspa","amount":1}'
# 期望 {"error":"bridge dest not supported: kaspa"}

# G3.4 — 负路径：负金额
curl -s -X POST '...' -d '{"toChain":"polygon","amount":-1}'
# 期望 400 error

# G3.5 — 负路径：无效 recipient
curl -s -X POST '...' -d '{"toChain":"polygon","amount":1,"recipient":"not-an-address"}'
# 期望 {"error":"recipient must be a 0x-prefixed EVM address"}
```

### Gate 4：小额真实桥（最终验证，花 ~$0.01 USDC fee）

```bash
# G4.1 — dust $0.1 USDC Arb→Polygon
curl -s -X POST 'http://127.0.0.1:3100/api/relay/c9c37c37-9a8c-484c-9893-20185d97ccf9/wallets/1eb8523a-071a-41c2-a16c-feaed020733b/bridge' \
  -H 'Content-Type: application/json' \
  -d '{"toChain":"polygon","amount":0.1}' | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const d=JSON.parse(s);console.log(d);if(!d.ok){process.exit(1)}});"

# 等 30 秒，然后验证 Polygon 侧到账
sleep 30
node -e "
const {JsonRpcProvider, Contract} = require('ethers');
const p = new JsonRpcProvider('https://polygon.drpc.org');
new Contract('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', ['function balanceOf(address) view returns (uint256)'], p)
  .balanceOf('0x9E1338E4898aBBD98059fB96b65c4Dd1254B1a50')
  .then(b => console.log('Polygon USDC:', (Number(b)/1e6).toFixed(6)));
"
# 期望：>0.09 USDC（扣 fee 后）

# G4.2 — chain_events 记录正确
node -e "
const db = require('better-sqlite3')('./data/console.db', {readonly: true});
const row = db.prepare(\"SELECT * FROM chain_events WHERE event_type='bridge_deposit' ORDER BY observed_at DESC LIMIT 1\").get();
console.log(JSON.stringify(row, null, 2));
if (!row || !row.txid) { console.error('G4.2 FAIL'); process.exit(1); }
"
```

### Gate 5：最终目标 — $54.34 落地

```bash
# G5 — 把 Arbitrum 剩余全部桥过去
node -e "
const {JsonRpcProvider, Contract} = require('ethers');
const p = new JsonRpcProvider('https://arb1.arbitrum.io/rpc');
new Contract('0xaf88d065e77c8cC2239327C5EDb3A432268e5831', ['function balanceOf(address) view returns (uint256)'], p)
  .balanceOf('0x9E1338E4898aBBD98059fB96b65c4Dd1254B1a50')
  .then(b => console.log('Arb USDC avail:', (Number(b)/1e6).toFixed(6)));
"
# 看到真实余额后（假设 54.24 扣过 G4.1 的 0.1），桥这个数

curl -s -X POST '...bridge' -d '{"toChain":"polygon","amount":54.24}'
# 等 30 秒查 Polygon 余额
# 期望：Polygon 总 USDC ≈ 54.0+ USDC（两次桥合计）
```

---

## ✅ Gate 成功标准

| Gate | 通过条件 | 卡住影响 |
|------|----------|----------|
| G1 | 3 项全绿 | 代码不对，别往下走 |
| G2 | 3 对 chain pair quote 都有 outputAmount | API 集成不对 |
| G3 | 5 个负路径都返回正确 error code | endpoint 不健壮 |
| G4 | dust 到账 + chain_events 正确 | 实际花钱验证通道 |
| G5 | $54.24 落地 Polygon | **最终目标达成** |

---

## 🚨 硬规则（memory 引用）

1. **`feedback_test_before_deliver`**：必须自测全绿才能报完成。不要跑完 G1 就说"修完"——G2/G3/G4/G5 也必须过。
2. **`feedback_communicate_first`**：修 bug 之前不必讨论，修完 + 测完之后才沟通结果。
3. **`feedback_use_system_rpc`**：测试脚本里 RPC 已用 `polygon.drpc.org` / `arb1.arbitrum.io/rpc`，与 chains.js 一致。
4. **NO TX NO STATE CHANGE**：G3 的负路径不得发任何 TX；G4/G5 每笔 TX 必须入 chain_events。

---

## 📌 任务完成回报格式

QClaude 完成后在 dev-coord 频道（或本地 `TASK-across-bridge-done.md`）回报，**必须包含**：

```
[G1] 全绿 ✓ / G1.x FAIL 原因
[G2] 3 对 quote 数据粘贴 + 判断
[G3] 5 个 error response 粘贴
[G4] 第一笔 bridge TX hash + Polygon 到账余额
[G5] 最终 Polygon USDC 余额 + 两笔 TX hash
```

不符合格式、或任何一项 FAIL，视为未完成。

---

**生成时间**：2026-04-23 深夜/清晨
**审查人**：Opus 4.7 (qclaude)
**审查依据**：live Across API 响应 + chains.js/chain-event.js 真实签名 + ethers.getAddress 硬验证
