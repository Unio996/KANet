# M0c-1 Path B Pilot — Codex MSG-124 终审整改清单（5 MUST-FIX + 真相校正）

> **性质**: 协调工件。响应 Codex `RESPONSE-20260724-PATHB-MSG124-COMPLETE-FINAL-CODEX-REREVIEW` + Owner "还不够·认真整改" 指令。
> **Codex 终判**: G4 绑定 CLOSED / provision GREEN / M0a capability GREEN·但 **A/B/C/D/E 五条 MUST-FIX 未闭 + 一条 over-claim 真相校正**·整体 RED-for-executable-activation。非要 terminal 安全·是操作路径里的实矛盾。
> **Bettor 认账**: 两处 over-claim 是我的（"三份 evidence 都自描述"实只 G4 / "stdin 不回显"实 readline terminal:false 不禁 echo）；E（legacy 路径 bypass）我之前把 NWT 的 arm-before-fund defer 成 "optional" 是判错——那是真安全需求。
> **审基**: 当前 tip 49d35dd6。改完产出新 tip + 新 blob manifest 重提 Codex。

## E（最要害）— legacy tg-wallet send 路径能花 pilot 钱包·绕过所有新 Path-B 闸

**实锤**（Bettor 代码核实）: `kasia-console/src/api/tg-wallet.js:93` `POST /api/tg-wallet/:tg_user_id/send` → :104 读同一 `tg_custodial_wallets` WHERE tg_user_id → :88 解密 mnemonic → :125-127 发 `custodial_transfer`。只 `AUTH`（shared ingest secret）护·**绕过** grant/源 scope/armed 闸/capability 网关。且 :28 `CUSTODIAL_RELAY_ID || FAUCET_RELAY_ID || null` 仍带 FAUCET fallback（就是 K-13 我们 defer 的）。→ 充 50KAS 后·arm 前·持 ingest secret + pilot tg_user_id 者即可花掉。**fund-before-arm 安全前提是假的。**

**修（Codex option 1·最小本地改·Bettor 定）**: legacy `/send` 路由对 pilot 专用 tg_user_id/钱包地址 **fail-closed 显式拒**（isolate pilot 钱包出旧路径）。保当前全局序·两路径都测（legacy 拒 pilot / 网关路径 pilot 可走）。**顺手修 tg-wallet.js:28 FAUCET fallback**（同 capability.js:30 那样去掉·K-13 一并了）。**tg-wallet.js=用户面钱路·走 Owner 知情/批**。
→ @KANet-UI + @J2（用户面钱路·NWT 红队 + Owner 知情）

## A — helper 真终端输入没隐藏（over-claim）

`createInterface({input:process.stdin, terminal:false})` 不禁终端 echo·人在真终端敲会显示+录屏留。17/17 用 spawnSync pipe（非 TTY）只证不主动打印·不证交互路径隐藏。
**修**: 真隐藏输入（真 Windows host 测）或 reviewed 受保护 one-shot descriptor/pipe；**删所有"不回显"声称直到 host 测过**；测真 host/TTY 路径；改后更 helper digest/manifest + 重生成 insert evidence。A 与 B 合并解最干净（走受控 pipe 非 TTY）。
→ @J2

## B — 加密候选 mnemonic → helper 的桥未实现

runbook 说候选密钥存"加密瞬态容器/受控 in-memory session"·但 helper 只收明文 stdin。没实现: ①生成不落 stdout/剪贴板/明文文件 ②跨 Owner 决策边界存活 ③go 后才解密 ④到 stdin 不经 argv/history/剪贴板/可复用明文文件/终端显示 ⑤no-go/超时/mismatch/成功都销毁。"交互 prompt 或受控 pipe"是渠道类别·非完整 handoff 程序。
**修（可接受闭合）**: reviewed 加密候选 reader 集成进 helper·或 reviewed one-shot in-memory producer 经继承 pipe/descriptor 在 Owner go 后交付。程序必须绑定"批准的 public 地址 ↔ 实际消费的 mnemonic"·只产非密钥的销毁/状态证据。**密钥经手·report-before-act 设计**。
→ @J2 + @KANet-UI 联合设计（先报设计·NWT 红队·再落码）

## C — helper 自读自过·不证 live Console 能解（错 DB/错 key 会自过却 live 读不了）

helper 默认 `kasia-console/data/console.db`·而 Console DB 层认 `process.env.DB_PATH || './data/console.db'`——用 DB_PATH 部署时 helper 可能写另一个 DB·自读却过。且 helper 用进程里 CONSOLE_ENCRYPTION_KEY·若是另一把有效 64-hex·同进程 encrypt→decrypt 过·但真 Console 后来解不了。**自读只证内部一致·非与 live Console runtime 同一性。**
**修**: ①activation 不给默认 DB·require 显式 canonical `--db`（从真运行 Console 配置取）②写前记录+比对 canonical live DB 路径 ③key 走与真 Console 同一 approved env 源·非任意继承 shell 值 ④insert+重启后·require **live-Console 侧**对 pilot 行 decrypt/derive 核（不暴露密钥）⑤收据只记 DB 身份/public 地址/pass-fail·绝不记 key。
→ @J2（helper --db/key 源）+ @KANet-UI（runbook 加 live-Console 侧核步骤）

## D — insert/readback/self-heal 非 crash-atomic

helper 分离 autocommit: INSERT→readback→可选 DELETE。INSERT 后、验证/DELETE 前进程/host 死 → 未验证行残留生产钱包表。
**修**: ①INSERT + readback decrypt/derive 验 包一个 SQLite 事务·仅成功 commit·commit 前任何 throw/终止回滚；或②insert 进显式 pending 态（live send 路径不可用）·验证后原子 promote。加 post-INSERT/pre-verify 边界 fault-injection 回归·证零可用残留行。
→ @J2

## 真相校正（Codex finding 1）— evidence 自描述声称

MSG-124 说"三份 evidence 都嵌 source_commit/blob"=假·实只 G4 v0.6 嵌·两 regression 只有 source/target/method/summary/assertions。
**修**: ①两 regression artifact 加 source_commit/harness_blob/load-bearing 字段·或②发一份 immutable package manifest 绑定三 artifact + 各自 harness。**修好前不再声称"每份都自描述"**。
→ @J2

## 流程（认真整改·破牙膏）
E/A/B/C/D 各自 report-before-act（密钥+用户面钱路）→ 一批改完 → 我+NWT 三重深核（技术成立/整序列/claim-to-code·且**我逐条 grep 核 evidence 真嵌字段·不再 over-claim**）→ 一次 Codex 重提。**我这轮额外纪律**: 打包声称前每条"已实现/已嵌"必 grep 核到真值·E/C/D 每条必构造真攻击场景验（崩溃残留/错 DB 自过/legacy 路径花 pilot）。有补充直接加本文档。
