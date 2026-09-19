# 设计稿：console 启动期 UTXO 自动拆分加开关（主网默认关）v0.1

> **Status**: CURRENT
>
> 起草 Bettor（架构师帽）· 2026-09-19 · 依据 Owner 本机终端原话「加开关，主网默认关。」（决策记为 DECISIONS.md **D-026**）· 起因 COORD-LEDGER (1533)(1534)：NWT 部署后核发现 console 每次启动无条件跑 `autoSplitAll()`，在主网真实烧费（两次启动各约 0.045 KAS，同四个账户来回拆合）；(1535) KANet-UI 指出开机自启上线后这会变成"任何一次断电 / 更新重启都在无人在场时发一批链上交易"。
>
> **执行门**：本页只是设计。顺序 = 本页 → NWT 设计审 → Bettor 派实现（J2 或 KANet-UI）→ NWT 审 diff → 合入 → 随下一次本来要做的 console 重启上线（重启 = 钱路动作，铁律 0）。**Bettor 不写代码。**
>
> **写作依 D-021**：不含密钥、助记词、地址、余额；手续费金额是已入账的公开数。

## 0. 结论

在 `kasia-console/src/services/utxo-splitter.js` 的 `autoSplitAll()` 入口加一道 env 闸：只有 `UTXO_AUTOSPLIT_ON_START` 的值**严格等于字符串 `1`** 才执行既有逻辑；否则打**恰一行** `[utxo-splitter] disabled (UTXO_AUTOSPLIT_ON_START!=1)` 并直接返回，**零 IPC、零 DB 写**。默认关，**不分网络**（理由见 §2.3）。`kanet.mainnet.env` **不写这个键**（不写 = 关），与驱动开关同款自查口径。

改动面：一个函数加一个早退分支 + 测试；`index.js:870-871` 的调用点**不动**；`splitUtxos()`、relay 端 `split_utxo` 命令、`/api/relay/:id/split-utxos` 手动接口、broker-intake-watcher 的补零钱路径**全部不动**（后者见 §4 单独说）。

## 1. 现状（只读实核，2026-09-19）

| 项 | 读数 | 出处 |
|---|---|---|
| 启动调用 | `import { autoSplitAll } …; await autoSplitAll();` 无条件、无 env、无网络判断 | `src/index.js:870-871` |
| 函数 | 查 `relay_nodes` 中有地址且有加密助记词的全部账户，逐个经 relay IPC 发 `split_utxo`（targetCount=8）；跳过 `UNREADABLE_RELAY_IDS` 两个与 proto relay（(1459) 闸 3 修复） | `utxo-splitter.js:56-82` |
| 主网实际 | 每次启动 4/18 账户被拆合，费用约 0.045 KAS；UTXO 数在同账户上 5→4→5、7→6→7 来回摆动，说明"目标 8 个"的判据在这些账户上不收敛（成因未读、不在本页范围） | (1533)(1534)，NWT 部署后核文件 §三 |
| 既有开关先例 | `PROTO_DRIVER_ENABLED !== '1'` ⇒ 拒 write；`[proto-driver] disabled` 一行日志；`DEMO_SEEDER_OFF !== '1'` 控 seeder | `proto-relay-ipc.mjs:87`、`proto-driver.mjs:212`、`index.js` seeder 段 |
| 既有测试 | `utxo-splitter.test.mjs` 用 `node --experimental-test-module-mocks --test`，mock `relay-manager.js` 的 `sendCommandAsync`，临时 DB 跑迁移，断言 IPC 调用数 | `src/services/utxo-splitter.test.mjs:15-46` |

## 2. 设计

### 2.1 闸的位置：函数入口，不是调用点
放在 `autoSplitAll()` 第一行而不是 `index.js` 调用点，理由：① 既有测试直接 `await autoSplitAll()` 断言 IPC 次数，闸在函数内才能被同一套测试正反覆盖；② `index.js` 是模块顶层 await 串，改它要重跑整个启动序列才能验；③ 将来若有别的调用者也会被同一道闸挡住，不会出现"调用点忘了加判断"。

```js
// utxo-splitter.js autoSplitAll() 第一行（示意，实现者照此写）
export const UTXO_AUTOSPLIT_ON_START_ENV = 'UTXO_AUTOSPLIT_ON_START';
export async function autoSplitAll() {
  if (process.env[UTXO_AUTOSPLIT_ON_START_ENV] !== '1') {
    console.log(`[utxo-splitter] disabled (${UTXO_AUTOSPLIT_ON_START_ENV}!=1)`);
    return { ok: true, disabled: true, split: 0, total: 0 };
  }
  console.log(`[utxo-splitter] startup autosplit enabled (${UTXO_AUTOSPLIT_ON_START_ENV}=1)`);
  … 既有逻辑原样 …
}
```

### 2.2 语义
- **只认字面 `'1'`**。`'true'`、`' 1'`、`'yes'`、`'0'`、未设 ⇒ 全部视为关。与 `PROTO_DRIVER_ENABLED` 同一约定，避免出现两种"开"的写法。
- 关闭态：**恰一行**日志、返回对象带 `disabled: true`、**不查 DB、不发 IPC**（早退在 `sqlite.prepare` 之前）。
- 开启态：多打一行 `enabled`，其余行为**逐字节不变**（既有四条测试在设 env=1 后必须原样通过）。
- 返回值：函数现在没有稳定返回值（调用点不接），本页定 `{ ok, disabled, split, total }` 只为测试可断言；调用点仍不接。

### 2.3 为什么不按网络分支
Owner 原话是"主网默认关"。本页取"**所有网络默认关**"：① D-017 起 TN12 已退役，本仓只剩主网一个运行网络，"非主网默认开"没有服务对象；② 少一条 `KASPA_NETWORK` 判断就少一个"我以为我在哪个网"的错误面（1092 / 网络单源那一族教训）；③ 要开就显式写 env，开与不开都在 env 文件里一眼可见。若 NWT 认为必须按网络分支，push-back 回本页。

### 2.4 不做什么
- 不改 `TARGET_UTXO_COUNT`、不改"不收敛"的判据（另开票，见 §4）。
- 不动 `splitUtxos()` 与手动接口 `/api/relay/:id/split-utxos`（操作员显式触发，不是无人值守）。
- 不动 relay 端。
- 不动 `kanet.mainnet.env`（不写键 = 关）。

## 3. 验收判据（落码时逐条过，每条带变异对照）

| # | 判据 | 变异对照（必红） |
|---|---|---|
| V1 | env 未设 ⇒ `sendCommandAsync` 调用数 = 0，`sqlite.prepare` 未被调用（用 mock 或 spy 计数），stdout 恰一行 `[utxo-splitter] disabled (UTXO_AUTOSPLIT_ON_START!=1)` | 删掉早退分支 ⇒ V1 红 |
| V2 | env = `'0'` / `'true'` / `' 1'` / `'yes'` 四种 ⇒ 同 V1 | 把 `!== '1'` 改成宽松判断（如 truthy）⇒ `'true'` 那条红 |
| V3 | env = `'1'` ⇒ 既有四条测试（proto 跳过、proto- 前缀跳过、普通 relay 被拆、混合集）原样通过，且多一行 `enabled` 日志 | 把早退条件写反 ⇒ 四条全红 |
| V4 | `index.js:870-871` 调用点 diff 为空 | — |
| V5 | `grep -cE '^\s*UTXO_AUTOSPLIT_ON_START=' kanet.mainnet.env` = 0（现场核，不是 git grep；(1529) M4 同款教训） | — |
| V6 | 部署后（下一次 console 重启）：stdout `[utxo-splitter] disabled` 恰 1 行、`[utxo-splitter] … → … UTXOs` 0 行、`accounts split` 0 行 | — |
| V7 | lint-kanet 0 error；测试命令与原始输出附在回执 | — |

## 4. 范围外但必须记下的两件事

1. **broker-intake-watcher 的 5 分钟补零钱拆分**（`broker-intake-watcher.js:669` `_ensureBrokerUtxoSplit` → `splitUtxos(BROKER_RELAY_ID)`）是**第二条运行期自动花钱面**，与启动期无关，本页不动。**Bettor 只读核（2026-09-19）**：该 watcher 只在 `index.js` 的 `if (process.env.BROKER_ENABLED === '1')` 块内动态 import 并启动（broker-optional，默认关，(1090)）；主网 console 本次启动后与死机前两份 stdout 里 `[broker-utxo-split]` 均 0 行 ⇒ **主网当前不跑**，不是活的花钱面。本页不动它；若将来打开 `BROKER_ENABLED`，须先给它同款开关（票 `T-BROKER-UTXO-SPLIT-MAINNET`，不排期），NWT 审本页时确认这个结论。
2. **"目标 8 个 UTXO"判据在主网四个账户上不收敛**（来回 5→4→5）：成因未读，本页不改判据；关掉启动期拆分后该现象自然停止，若将来要开，先修判据再开。另开票 `T-UTXO-SPLIT-NONCONVERGENT`。

## 5. 上线

- 合入主线后**不会**自动生效：需要 console 重启。重启本身是钱路动作（铁律 0），**并入下一次本来就要做的 console 重启**（P3 memory-alert 上线那次，(1535) M-5），不为本页单独重启。
- 诚实口径：那一次重启起的是**新代码**，所以从那次起就不再拆分；但停旧进程之前旧代码不会再跑拆分（拆分只在启动时跑），所以**不存在"最后再烧一次"**。
- 上线前 Owner 不需要再批：D-026 已批"加开关、默认关"；开关**打开**（写 `=1` 进主网 env）是另一次钱路决定，须 Owner 单独批。

## 6. 给 NWT 的审点
- 2.1 闸放函数入口 vs 调用点，有无我没看到的调用者会因此改变行为（Bettor grep：`autoSplitAll` 只有 index.js 一个调用点 + 测试）。
- 2.3 不按网络分支的取舍。
- §4-1 broker 补零钱路径在主网的实际状态与是否同款处理。
- 是否有任何路径把"启动期拆分"当作活性前提（Round 1 风暴防护是 broker 高频场景，主网当前无 broker 流量，Bettor 判无）。
