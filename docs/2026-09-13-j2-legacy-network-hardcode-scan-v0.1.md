# 全仓硬编码旧网端口/网络标识 · 只读扫描 v0.1

> **Status**: FINAL-EVIDENCE **v0.1**（2026-09-13 · J2 · Bettor 派工「做全仓硬编码旧网端口（16211/17210/18210 等）与网络标识字符串的只读扫描，docs 一页（file:line、是否在主网路径可达、建议改法），b 的 lint 只管地址前缀不管端口」· 方法 = `git grep`（只查 git 跟踪文件，`node_modules` 天然排除）+ 逐文件读上下文判定可达性 + 交叉核对 `kasia-console/src/index.js` 的 cron/服务 import 表判定"是否在启动路径上"· 纯只读，未改一行代码 · 交 Bettor + NWT 判优先级。🔴 遵 Owner 直令：本稿只列 file:line 与端口数字，不在正文出现旧网具体名称（用"旧网"/"testnet-12 字面量"字样时限定为**代码里出现的字符串本身**，不是本文档在使用它作身份指代）。

## 0. 结论（四句）

1. **端口扫描**（`16211`/`17210`/`18210`）：`17210` 在代码里有 **2 个真·主网路径可达**的硬编码回退默认值（§1.1①②），其余 30+ 处全是手工探针/已冻结旧网专用脚本/测试夹具/文档提及，不在主网启动路径上。`16211`/`18210` 在代码里**零命中**——两个数字唯一出现的地方是两份文档对官方端口方案的说明性描述，不是配置值。
2. **网络标识字符串扫描**（`'testnet-12'` 字面量）：branch b 已改的 33 处之外，还有 **68 个文件**命中该字面量；逐个分类后，**5 个真正的"静默错网"风险点在主网路径上**（§2.1），其中 **4 个是 branch b 同一缺口类型的漏网之鱼**（用地址前缀反推网络，而不是从 env 读——b 的 33 处清单没扫到它们）。
3. **DB schema 层**（`migrate.js`）两处默认值/约束仍含旧网字符串（§2.3），是否要改是数据库迁移决策，本稿只如实记，不建议动作。
4. **b 的 lint（`R-NET-PREFIX-INFER`/`R-NET-PREFIX-EITHER`）确实只管地址前缀推断，不管端口硬编码**——本稿 §1 的两处端口发现和 §2.1 的 5 处字符串发现都不会被现有 lint 拦；若要机械化防复发需要新 lint rule（列 §4 供 NWT 判是否要开）。

## 1. 端口扫描（`16211` / `17210` / `18210`）

### 1.1 主网路径可达（真风险，建议改）
| # | file:line | 现状 | 建议改法 |
|---|---|---|---|
| ① | `kasia-relay/src/relay.mjs:1106` | `const rpc = new RpcClient({ url: process.env.KASPA_RPC_URL \|\| 'ws://127.0.0.1:17210', encoding: Encoding.Borsh, networkId });`——relay 主进程，`KASPA_RPC_URL` 未设时静默连旧网端口 | **已在 (a) 设计稿列为待删项**（`docs/2026-09-13-j2-local-only-strict-rpc-design-v0.1.md` F5/S6：strict 模式下改 `throw`，不回退硬编码）；三分支合入后随 (a) 落码这行自然消失，本稿不重复派工，只确认它在扫描范围内被覆盖 |
| ② | `kasia-console/src/services/bshard-settle-daemon.mjs:51` | `const RPC_URL = process.env.SETTLE_DAEMON_RPC_URL \|\| 'ws://127.0.0.1:17210';`——该 daemon 由 `index.js:718` 在启动时 `startSettleDaemonCron` 等函数拉起，是**持续运行的 live cron**；`kanet.env` **没有** `SETTLE_DAEMON_RPC_URL` 这一行（核过，不存在）⇒ 当前永远走这个硬编码默认值 | **(a) 设计稿未覆盖**（它只扫了 `rpc-health.js`/`relay-manager.js`/`transaction.mjs` 等几个核心文件，这个 daemon 独立维护自己的 `RPC_URL` 常量，是漏网点）。建议：删专属 env 变量，直接读 `process.env.KASPA_RPC_URL`（同其余 daemon 的既有模式，见 `oracle-pool-chain-scanner-cron.mjs:33`），strict 模式下未设即 throw；不要保留旧网默认值 |

### 1.2 其余 `17210` 命中（35 处，不在主网路径 / 低风险）
逐类：
- **一次性诊断/攻击面探针脚本**（`kasia-console/scripts/attack-self-claim.mjs`、`build-v0_7_1-claim-tx.mjs`、`checksigfromstack-e2e-onchain.mjs`、`verify-settle-sigs.mjs`、`bshard-probe-blake2b.mjs`、`scripts/backfill-payout-ps-addr.mjs`、`scripts/j1-*.mjs/.sh`、`scripts/kaspad-rpc-probe.mjs`、`scripts/_tmp-relay-spawn-debug.mjs`）——全部人手一次性调用，**不在任何 cron/启动路径上**；多数已带 `process.env.KASPA_RPC_URL ||` 回退形，跟 §1.1 同款但危害面小得多（手工跑时人会看着结果，不会静默跑很久）；建议**不逐个改**，机会成本 > 收益，除非要写这类脚本的通用规范。
- **已冻结/旧网专属脚本**（`scripts/kaspad-watchdog.ps1:47`、`scripts/kanet-boot-sequence.ps1:80/81/84`、`scripts/tn12-*.ps1/.mjs`、`kanet-start.sh:178` 注释）——文件名/用途本身就是旧网专属（watchdog 参数带 `--netsuffix=12` 等），随 Owner 冻结指令**整批不再需要改**，主网节点走独立的执行页（876cc412），不复用这些脚本。
- **测试夹具**（`kasia-console/src/**/*.test.mjs` 6 个文件，`KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210'` 形）——测试自举默认值，只在测试进程里生效，不影响生产；低优先级，可在下次碰这些文件时顺手换成不带网络倾向的默认（如直接读 env 不给硬编码）。
- **文档/模板**（`docs/onboarding/ext-agent-publish-offer.template.mjs`、`docs/examples/kanet-external/send-comm.mjs`、`docs/csfs-e2e-evidence/verify-utxo-spend-state.mjs` 及若干 `docs/*.md` 说明性提及）——外部集成模板/历史证据文档；模板类若要给主网上的第三方接入者用，需要在**发布模板前**单独过一遍（不在本次三侧分支合入范围，标记给外部文档维护方）。
- `kasia-console/scripts/xnode-artifacts-canonical.json:240/247` 的 "16211" 命中是**误报**：该串是一段 32 字节 covenant-id/redeem 十六进制大块（`…f5b7fcc216211bfccc…`）里偶然包含的子串，不是端口配置——予以排除。

### 1.3 `16211` / `18210`
两个数字在**任何代码文件（`.js/.mjs/.ps1/.sh/.env/.json`）里零真实命中**（§1.2 已排除的一处 JSON 误报除外）。唯二出现处是两份文档对官方端口方案的**说明性文字**（`docs/2026-09-13-kanetui-tn12-retire-mainnet-node-runbook-v0.1.md:166` 解释 gRPC/borsh/P2P 默认端口对照表；`docs/new-architect-briefing.md:29/287` 列旧网端口备忘），不是配置值，**无需改动**。

## 2. 网络标识字符串扫描（`'testnet-12'` 字面量，排除 branch b 已处理的 33 个文件）

68 个命中文件里，绝大多数是**注释**（解释某个 wasm/rusty-kaspa 行为差异，如 `p2sh.mjs:45`、`tx-mass-ub.mjs:5`、`wallet.mjs:123-125` 的 Generator 网络字符串映射说明）、**查找表的合法键**（`wallet.mjs:11` 的 `NetworkType` 映射、`api.mjs:6` 的 explorer URL 映射——这些是"支持旧网"这个既有能力的正常实现，不是"误当默认值"的 bug，冻结旧网不等于删除对它的既有支持代码）、**错误消息文案**（`oracle-stake-v1.mjs:45`）——这些**不需要改**。真正落在"静默错网默认值"这一类的只有下表：

### 2.1 真风险（5 处，主网路径可达）
| # | file:line | 现状 | 类别 | 建议改法 |
|---|---|---|---|---|
| ① | `kasia-relay/src/lib/transaction.mjs:282` | `const net = network \|\| process.env.KASPA_NETWORK \|\| 'testnet-12';`（`custodialSendKaspa` 内，KANet-UI TG 托管转账路径） | 硬编码回退默认值 | 同 §1.1②：strict 模式下未设即 throw，不回退 |
| ② | `kasia-console/src/services/bshard-settle-daemon.mjs:52` | `const NETWORK = process.env.KASPA_NETWORK \|\| 'testnet-12';` | 硬编码回退默认值 | 同上；与 §1.1② 同一文件的姊妹行，**两行一起改** |
| ③ | `kasia-console/src/services/oracle-pool-chain-scanner-cron.mjs:33` | `const networkId = process.env.KASPA_NETWORK \|\| 'testnet-12';`（live cron，`index.js:709` 拉起） | 硬编码回退默认值 | 同上 |
| ④ | `kasia-console/src/services/oracle-pool-renewal-cron.mjs:126` | `const networkId = process.env.KASPA_NETWORK \|\| 'testnet-12';`（live cron，`index.js:713` 拉起） | 硬编码回退默认值 | 同上 |
| ⑤ | `kasia-console/src/lib/faucet-utxo-health.mjs:21` | `const NETWORK = 'testnet-12';`（**无 env 覆盖，纯常量**；live cron，`index.js:750` 拉起） | 无条件硬编码（比①-④更严重：连 env 都不读） | 改成 `process.env.KASPA_NETWORK`（strict 下未设 throw），或至少加 env 覆盖再谈默认值 |

**🔴 顺手发现（b 的缺口）**：以下 4 处不是"硬编码默认值"，而是**从地址前缀反推网络**——与 branch b 设计文档开篇点名的"今天 33 处 `startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'` 的病"**逐字同款**，但**不在 b 已处理的 33 个文件名单里**：
| file:line | 现状 |
|---|---|
| `kasia-console/src/services/prediction-params-cache.js:106` | `network: ctorParams.p2sh_addr?.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet',` |
| `kasia-console/src/services/trade-protocol-filter.js:371` | `const network = (msg.p2sh_addr \|\| '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';` |
| `kasia-console/src/services/trade-protocol-filter.js:787` | `const network = msg.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';` |
| `kasia-console/src/services/trade-protocol-filter.js:1434` | `const network = market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';` |
| `kasia-console/src/services/trade-protocol-filter.js:1470` | `network: market.spine_p2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet',` |

这 5 个位点（1 文件 + 1 文件 4 处）建议**并入 b 的既有机制**（`shared/lib/kaspa-network.mjs` 的单一源 helper），而不是单独修——b 的 lint（`R-NET-PREFIX-EITHER`）设计上就是为了抓这个模式，**没抓到是因为这 5 处在 b 落码时还不存在/未被扫描范围覆盖**（需要 NWT 确认：b 的 33 处清单是怎么产生的——若是手工 grep 某一次性清单，这 5 处大概率是同批 grep 的遗漏；若 lint 规则本身该常驻扫描却没拦，则是 lint 规则的覆盖面问题，§4 列)。

### 2.2 低风险 / 无需动（分类，不逐条列 file:line，样本已在上方举例）
- 网络映射查找表的合法键（继续支持旧网地址/API 不是 bug）。
- 解释 wasm/consensus 行为差异的注释。
- 错误消息文案。
- 测试文件内的网络参数（自举用，不影响生产）。
- `bettor-prediction-settler.js:158` 那类"双前缀都接受"的**注释**——它标记的是一处**故意**同时接受两种地址前缀的代码（防"testnet-12 kaspatest: 地址被误拒"的历史 bug），这是设计选择不是硬编码默认值 bug；**是否应在纯主网运营下收紧到只认 `kaspa:`** 是产品/安全决策，本稿只如实记，列 §4 供判。

### 2.3 DB schema 层（如实记，不建议动作）
`kasia-console/src/db/migrate.js`：
- `:5166` 某表 `network TEXT NOT NULL DEFAULT 'testnet-12'`。
- `:5771` 另一表 `network TEXT NOT NULL CHECK (network IN ('testnet-12', 'mainnet'))`（`:5754` 注释提到与 `u1-s10-identity.mjs` 的 `S10_NETWORKS` 集合要保持机械一致）。
这两处是**表结构**，既有历史行的 `network` 列值本来就该是旧网字符串（如实记录历史，不是错误）；风险面窄——只有当代码在 INSERT 时**没有显式传 `network`** 而依赖 DB 默认值时，`:5166` 那个 `DEFAULT` 才会让新行落错网。本稿未逐一核对所有对该表的 INSERT 语句是否都显式传值（超出只读扫描范围，需要单独一次"该表全部写入点"审计）。`CHECK` 约束（:5771）保持双值不算 bug——它是**允许**两种网络值，不是默认成某一种。

## 3. 与三侧分支合入报告（`docs/2026-09-13-j2-three-side-branch-merge-order-precheck-v0.1.md`）的关系
- 该报告 §3 已列 `kanet.env` 三行端口/网络值改动；**本稿 §1.1②/§2.1①-⑤ 是那份报告"未核到"里"全仓硬编码"的补完**——env 改对了，但如果代码里还有独立于 env 的硬编码回退（本稿列的 5+2 处），env 改了也救不了它们。
- 建议：§1.1②、§2.1①-④（同一批 daemon/relay 文件）与三侧分支的 (a) 分支改动**是同一类修法**（strict 模式下 throw 不回退），可以在 (a) 分支落码时**顺手扩面**一起改，不必等三侧分支合入后再开新 patch；`faucet-utxo-health.mjs`（§2.1⑤）连 env 读都没有，改动量比其余几处略大（先加 env 读再谈 throw），可单独一笔。

## 4. 请 NWT / Bettor 判
1. §2.1 的 5 个"漏网点"是否要并入 (a)/(b) 分支现在就改，还是单独开一笔新 patch（不影响已核过的三侧分支合并序，是否要开"第四个小分支"或直接加进 (a)/(b)）。
2. 是否要为 §1 的端口硬编码开一条新 lint rule（形照 `R-NET-PREFIX-INFER`，改抓 `\|\| 'ws://127.0.0.1:172\d\d'` 这类模式）——本稿只发现问题，未评估 lint 规则的假阳性率（测试夹具/一次性脚本大量合法使用硬编码端口做隔离，rule 需要白名单机制，工作量未估）。
3. `bettor-prediction-settler.js:158` 那处"双前缀都接受"是否要在纯主网运营下收紧。
4. `kasia-console/scripts/xnode-artifacts-canonical.json` 里的旧网身份数据（`shardPoolId`/`slRedeemHex` 等，非端口误报那两行，是真实的旧网历史产物）是否需要连同旧网退役一起归档/清理——不在本次端口/网络标识扫描范围，只是扫描时顺路看到，标记供参考。

## 5. 没核到的
- `migrate.js` 涉及的那两张表的**全部 INSERT 语句**是否都显式传 `network`（§2.3 提到的风险面，本次未逐一审计，工作量较大需要单独一次调用点扫描）。
- 端口/网络字符串以外，是否还有其他形式的"旧网身份"硬编码（如特定 covenant-id 常量、特定 P2SH 地址字面量）——本稿严格限定在 Bettor 要求的"端口 + 网络标识字符串"两类，未扩大范围。
- `docs/onboarding/`、`docs/examples/kanet-external/` 两个外部面向模板具体由谁（KANet-UI？）负责在主网公开前更新，未核认领方。
