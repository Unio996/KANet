# 外部程序「kaspa 化」实跑记录 v0.1 —— 我从零走了一遍

> Bettor 21:04 派 · Owner「最快速度先跑通，不要拘泥细节」
> **这不是设计稿。每一行都是我实际跑过的命令与实际收到的返回。跑不通的标 `NOT_AVAILABLE` 并说明卡在哪。**
> 执行者：J2，扮演一个**外部程序** —— 全新密钥、不用任何现有 relay 身份、不碰 50 KAS pilot 钱包。

## 📌 一句话结论

```
✅ 密钥 · 签名 · 付费 · 广播 · 上链 —— 外部程序【全部能自己做】, 不需要我们
🔴 而卡住它的有两件, 都不是链的问题:
   ① 测试币: 接口存在, 而【在控制面上, 外部不可达】
   ② 一个【外部不可能自己发现】的参数值 —— 传对的值会得到零信息的 wasm panic
🔴 而信封格式仍未产出(本次未做, 见 §5)
```

---

## ① 生成密钥 —— ✅ 通，不需要我们

**外部人要装的**：`npm i kaspa-wasm@1.1.0`（官方 `kaspanet/rusty-kaspa` 的 WASM 绑定）
⚠️ **本仓是 vendored 副本**（`shared/vendor/kaspa-wasm/`），所以仓内代码写 `import 'kaspa-wasm'` 能解析，**而在仓外的空目录里不能** —— 外部人必须先 npm 装。

<!-- ux1:executable -->
```js
import * as kaspa from 'kaspa-wasm';
const { Mnemonic, XPrv, NetworkType } = kaspa;
const mn   = Mnemonic.random();
const key  = new XPrv(mn.toSeed()).derivePath("m/44'/111111'/0'/0/0").toPrivateKey();
const addr = key.toAddress(NetworkType.Testnet).toString();
```
**实际返回**（本次生成的一次性测试身份）：
```
address kaspatest:qrx45rpscqffd2a2wll2vjwu3q09r6f65pqauugwmq3urtxevenwyj9y3en72
```

---

## ② 拿测试币 —— 🔴 `NOT_AVAILABLE`（外部不可达）

**实跑，两个口都试了**：
```
POST :3210/api/faucet/request  (对外网关)  ⇒ 🔴 404 Route POST:/api/faucet/request not found
POST :3200/api/faucet/request  (控制面)    ⇒ ✅ 200 {"ok":true,"txid":"cc7b2568…","amount":"10000 testnet KAS"}
```
🔴 **准确标法（照 NWT 21:06 的更正）**：不是"只有人工网页" —— **程序接口是存在的**（`chat.js:596`，带 per-wallet 永久一次 + per-IP 24h≤3 + 指纹 + 全局日帽）。
🔴 **它只是不在对外那个口上。而给人点的 `/faucet` 网页（`chat.js:473`）同样在控制面** ⇒ **两条路外部都够不到。**

⚠️ **我用了内部路径（本机打 3200）才拿到币，后续步骤才得以继续。** 外部人今天走不通这一步。
🔵 而这一格是**放行清单的决定**，不是技术缺失 —— 归 Bettor/Owner。

---

## ③④ 自己构造 · 自己签 · 自己付费 · 自己广播 —— ✅ 通，且**不需要我们的任何接口**

🔵 **一个纠正**：此前记的「广播能力不存在，`submitTransaction` 七处全在 `p2sh.mjs`」——
那是**我们代码里**的情况。而外部程序**根本不用我们的代码**：它用 kaspa-wasm 直连节点提交。
**实测节点 `ws://127.0.0.1:17210` 可连、已同步（`1.1.1-toc.1`, `isSynced=true`）**，且它绑 `0.0.0.0` ⇒ 本网段可达。

<!-- ux1:executable -->
```js
const rpc = new RpcClient({ url:'ws://<HOST>:17210', encoding:Encoding.Borsh, networkId:'testnet-12' });
await rpc.connect();
const { entries } = await rpc.getUtxosByAddresses([ADDR]);

const gen = new Generator({
  entries,
  outputs:      [new PaymentOutput(new Address(ADDR), kaspaToSompi('1'))],
  priorityFee:  kaspaToSompi('0.01'),
  changeAddress: new Address(ADDR),
  networkId:    'testnet-10',                                  // 🔴🔴 见坑 ①
  payload:      new Uint8Array(Buffer.from(payloadHex,'hex')), // 🔴 见坑 ②
});
let pending, txid;
while ((pending = await gen.next())) { await pending.sign([key]); txid = await pending.submit(rpc); }
```

**实际返回**：
```
UTXO: 1 · sompi 1000000000000
已提交 txid: 089dd883d7068e01c400cad0a0e95a8af415db54562b3f168b9b35135cb7fc26
fees: 1213000 sompi
落地核实(自己查节点, 不问 KANet):
  outpoint 089dd883… idx 0 amount 100000000      (self-send 1 KAS)
  outpoint 089dd883… idx 1 amount 999898787000   (找零)
```

---

## 🔴 坑 —— 每一个都只给同一句零信息报错

**所有下列错误的表现完全一样**：
```
RuntimeError: unreachable
    at wasm://wasm/02cfe956:wasm-function[5871]:0x793a99
    …(纯地址栈, 没有任何一行提到是哪个参数错了)
```

| # | 坑 | 外部人会怎么写 | 必须怎么写 | 严重度 |
|---|---|---|---|---|
| ① | **`Generator` 的 `networkId` 不认 `testnet-12`** | `networkId:'testnet-12'`（真实网络名，而且 `RpcClient` 就是这么传的） | `networkId:'testnet-10'` | 🔴🔴 **外部不可能自己发现**。仓内靠 `wallet.mjs:95-98` 一行硬映射绕过：`if (this.network === 'testnet-12') return 'testnet-10'` |
| ② | `payload` 必须是**字节** | hex 字符串 / Node `Buffer` | `Uint8Array` | 🔴 |
| ③ | `outputs` / `changeAddress` 必须是**对象** | `{address:'kaspatest:…', amount}` / 字符串 | `new PaymentOutput(new Address(…), amt)` / `new Address(…)` | 🔴 |
| ④ | `createTransactions()` 这个 API | 文档里有，直觉会用 | 用 `new Generator({…})` | 🔴 |

🔵 **对照组**：`hexToBytes is not a function` —— 同一段代码里的另一个错，**有名有姓、一眼可修**。
**⇒ 差别不在难度，在于错误信息说不说话。** 一个外部开发者在坑①上会反复检查自己的密钥和 UTXO —— 而问题在一个他没理由怀疑的字符串上。

---

## 🔴 §5 未做的

```
🔴 信封格式(ciph_msg:1:comm: 之后那段加密体) —— 本次【未构造真实信封】
   我发的 payload 是明文探针 'ciph_msg:1:comm:J2-EXTERNAL-PROBE-…'
   ⇒ 所以【没有验证"另一侧读出明文"这一步】。那一步 J1 08:11 验过, 而这次不是我验的
🔴 因此本记录证明的是: 外部程序能【自己签自己付把任意字节送上链】
   ⇒ 它【不证明】外部程序能发出一条我们这边能读懂的消息
🔴 未从另一台机器跑过 —— 全程在本机
```

## ⚠️ 我用了内部知识的地方（外部人没有）

```
🔴 坑① 的解法: 我是去读 wallet.mjs:95 才知道要传 testnet-10
🔴 坑②③④ 的解法: 我是去读 transaction.mjs:214 的 Generator 用法才对上的
🔴 ② 那一步的币: 我用本机 3200 拿的, 外部拿不到
⇒ ⇒ 也就是说: 这份记录里【每一个我跨过去的坎, 外部人今天都跨不过去】——
   而这正是要产出的东西: 把这四格写下来, 它们就不再是坎。
```

**本次动作**：生成一次性密钥 · 领 10000 测试币 · 发 1 笔链上交易（费 1213000 sompi）。
未动生产身份 · 未动 50 KAS pilot 钱包 · 未改任何产品码。
