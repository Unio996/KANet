# 2026-09-19 J2 — 批3 market_seal 黄金回归夹具 + NWT 批3独立验证 N1/N2 补丁

对应：Bettor 转达 NWT 对批3见证编码器的独立验证（PASS-with-notes）两条要落码的 notes，及硬要求
"改动不得改变合法路径的字节，须用与 30d7e951 那次真实上链字节逐字节相同的回归证明"。
D-021 合规：仅 simnet 数据，无真实地址、无私钥。

## 期望字节的来源（独立于本仓 builder）

`kasia-console/test-fixtures/proto-batch3-market-seal-onchain.json`（sha256 前 16 位 `1dbc0e179dd0d597`）：
- **期望值**（三个 input 的 outpoint/sequence/computeBudget，input0/1 的签名脚本，三个 output 的
  value/spk/covenantId/authorizingInput，txid）取自 **simnet 节点上真实上链的那笔 market_seal**
  （txid `e2c45b32…24c8`），用只读 `getBlocks(includeTransactions)` 扫块读出（`06_extract_onchain_seal.mjs.txt`），
  不是 builder 的输出。fee 输入（index 2）的签名脚本由 relay 签，不是 builder 产物，夹具里置空。
- **参数**（marketId、deadline、委员公钥、rootCloseTmplHash、leaf 状态等）取自批3 的 chain 记录
  （`07_make_seal_fixture.mjs.txt` 生成）。fee 输入面值 95,000,000 = 链上找零 60,614,000 + 实付 34,386,000。
- 节点：`kaspad 2.0.1` simnet PID 15972（sha256 前 8 位 `8afe6a68`）；本次全程只读，未向节点提交任何交易。

## 结果（`node src/lib/proto-tx-assembly-settlement-golden.test.mjs`，9/9 PASS）

- 用批3参数重建 market_seal：**无见证 txid 与链上相同**；**leaf(input0) 与 held(input1) 签名脚本逐字节等于链上**
  （input0 = 34,559 字节，input1 = 3,215 字节）；三个输出的 value/spk/covenantId/authorizingInput 与链上一致。
- N2（`heldInput=null` 构造期 fail-closed）：throw 且报文含 `fail-closed` 与 `heldInput`。
- N1：见下"负向对照"。

## 负向对照（证明这些测试不是恒绿）

1. **拿修改前的 builder（`git show HEAD:` 版本）跑同一测试**：黄金回归 4 条仍绿（**证明 N2 守卫没有改变合法路径字节，
   修改前后都逐字节等于链上**），N2 那条红（"heldInput=null 应该 throw，却成功返回了"）。
2. **夹具里 input0 签名脚本翻 1 个 nibble**：字节比对那条红（"hex 偏移 34559 处首个字节不同"），其余绿。
3. **在 builder 副本里把 `tokenInIdx`/`tokenOutIdx` 换位**：黄金回归 4 条、③N1 两条、③b **全部仍绿**（真实封盘形状里两者
   都是 1，链上与黄金回归都看不出换位），**只有 ③a（`sealWitnessArgs` 用 heldIdx=5≠tokenOut=1 的向量）变红**。
   ⇒ N1 的换位风险**只由 ③a 守着**：为此把 builder 里的具名参数映射抽成纯函数 `sealWitnessArgs`（字节不变，
   黄金回归为证），使它可以用两者不同的向量单测。

## 附带发现（对 Bettor 此前要的"节点原始返回"）

已上链的交易在区块记录里带着节点自己算的 `storageMass` / `mass` / `verboseData.computeMass`，
可以用只读 RPC 事后取回原始值，**不需要重新提交**。本笔 market_seal 的原始记录见
`raw-onchain-market-seal-node-record.txt`：storageMass=231,312、mass=231,312、computeMass=60,422，
与批3 provenance 表一致，且是节点原始字段而非解析后转述。
（register_append#1/#2 与 genesis 同样取回了，见文末"补充"。）

## 没有证明的

- 黄金回归只覆盖**批3 那一个形状**（route A 参数、fee 95,000,000、count=2）；其它 state/面值的字节没有链上黄金。
- ③N1 的编码器向量证明"编码器按 ABI 声明顺序放置具名参数"，不证明 ABI 声明顺序与共识读取顺序一致——
  后者只由真实共识 ACCEPT（批3 simnet）证明，且 NWT 已用三个独立来源逐字节验证过该形状的见证。

## 补充（Bettor 要求）：批3 四笔交易的节点原始 mass 记录（只读取回）

`raw-onchain-batch3-four-txs-node-records.json`，由 `08_fetch_onchain_mass_records.mjs.txt` 只读取回
（`getBlocks(includeTransactions:true)` 扫 simnet 区块，共扫 2,471 个块；读的是区块内交易记录自带的
节点侧 `storageMass` / `mass` / `verboseData.computeMass` 字段，以及所在区块的 hash 与 daaScore）。
签名脚本只留字节数与 sha256 前 16 位，未存全文。全部四笔 version=1：

| 步骤 | storageMass | mass | computeMass | 区块 daaScore |
|---|---|---|---|---|
| market_genesis | 207,749 | 207,749 | 8,083 | 2455 |
| register_append#1 | 457,504 | 457,504 | 33,927 | 2456 |
| register_append#2 | 293,116 | 293,116 | 44,198 | 2457 |
| market_seal | 231,312 | 231,312 | 60,422 | 2458 |

与批3 provenance 表逐项一致；这一次的数字是**节点原始字段**（不是当时 getMempoolEntry 输出的解析转述）。
注意 `mass` 字段等于 storageMass、不是 max(compute, storage)——两个维度必须分别核对。
**局限**：这是"已上链交易的节点记录"，不是"提交前的 getMempoolEntry 原始 JSON"；对没提交过的形状（如 fee=100M）仍取不到。
