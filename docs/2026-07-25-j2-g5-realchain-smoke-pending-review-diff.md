# J2 · G5 real_chain smoke(m0c1-gate)pending-review diff

> **性质**: pending-review 工件(供 NWT 红队 + Bettor 核 + KANet-UI 审), 代码在共享工作树未 committed(`git diff`可直接看到实际改动)。
> **依据**: Bettor 派工(dev-coord-testnet #za2prd/#z8kz.., "只写不跑, 发完整diff"), Owner "测试框架替代真人全自动"方向, Codex §4.5 live-money-landing 要求。

## 背景

G4(`g4-pilot-custodial-e2e.mjs`)27/27 已把 custodial_transfer 门控**机制**证到底, 但故意死端口 stub 链(零真链接触, 隔离铁律非缺陷)。本次补的 delta = 唯一没证的那块: 一笔合法请求打到活的 Console 进程, 经真实 armed 的 capability 网关, 真广播到 testnet-12, 独立可验证落地。

## 改动

### 新文件 `kasia-console/test-framework/cases/m0c1-gate/g5-pilot-custodial-real-chain-smoke.mjs`(201 行)

- **真钱预算**: `MAX_TRANSFER_KAS = 2`(硬编码 cap, CLI 传超过直接 abort, 独立于 grant 自己的 scope, 纵深防御)。
- **gate 条件**(硬代码检查, 非注释声明, 缺一 abort 不碰钱):
  - ① `deployed_commit == --expect-package-commit`(git rev-parse HEAD 核对)
  - ② 网关未 disabled(POST 后读响应里的 disabled 语义, 非额外一次探测请求)
  - ③ candidate 钱包链上真实余额(直连 RPC 查, 非 DB 缓存值)≥ amount+0.05 gas
  - ④ 默认 dry-run, 缺 `--confirm` 只跑①③门检+打印 envelope 摘要, 不发送
- **不 provision grant**: 消费一个已存在的 grant(`--grant-id/--app-key-id/--app-priv-key-file`), 角色是 runbook §4.5 人工 curl 步骤的自动化替身——不新增授权入口, `m0c1_app_grants` 写入方仍静态锚定 `scripts/m0c1-grant-provision.mjs` 一处(m0c1-grant-registry-schema.js 头部纪律)。
- **payee**: `peers.mjs` alias `faucetrelay-tn`(见下), 不硬编码。
- **envelope 构造**: 复用 `test-framework/lib/app-envelope-sdk.mjs` 的 `buildAppCmd()`(签发端跟 relay 侧 `app-envelope.mjs` 同一份 canonical 定义, 单一真相源)。
- **落链验证**: 直连 RPC(`kaspa-wasm RpcClient.getUtxosByAddresses`)查 payee 地址真实 UTXO, 断言存在匹配 txId 的条目——**不读 `kaspa_tx_log`**(Bettor 纠正: 本地 indexer 会漏块+命中≠仍 canonical, 见 memory `reference-kaspa-tx-log-indexer-completeness-gap`/`reference-kaspa-tx-log-hit-is-not-canonical-chain-proof`), 跟 relay 侧 `check_utxo_landed`(relay.mjs:1189)同一验证语义但独立实现(不依赖同一 relay 子进程内部记账)。
- **evidence**: 复用 G4 自描述字段(source_commit/harness_blob_sha/run_params), 记 txId + 独立 RPC 落地验证结果。
- **manual only**: m0c1-gate 域全部现有 case(G4/harness/两个 regression)都是"直接 node 调用", 没有 cron/batch 自动发现机制会碰到这个文件——已核实(scripts/test.mjs 只发现 `.test.mjs` 后缀的 broker 域声明式 case, 本文件是 `.mjs` 不会被扫到)。

### `kasia-console/test-framework/lib/peers.mjs`(+5 行)

新增 alias `'faucetrelay-tn'`(地址+relay_id 两个映射表都加), 值已核对 == `relay_nodes` 表 `FaucetRelay-tn`(id=`7c4cb102-8476-40f9-bd85-c528bffaf8aa`)那一行, **非** `FaucetRelay-tn-2`(历史上 UTXO 枚举崩过的巨额地址, `d9a8fffb...`, 两者是不同两行, 已核对不会认错)。不改动既有映射。

## lint

`node scripts/lint-kanet.mjs` 两文件 0 errors(先前一次 `R-FETCH-NO-TIMEOUT` 命中已修: fetch 调用补 `AbortSignal.timeout(45000)`, 同 `portfolio.eta` 转账调用惯例)。

## 未决 / 待你们审的点

1. **§3.6 grant 依赖**: 本脚本假设 grant 已经通过 runbook §3.6(`m0c1-grant-provision.mjs issue`)在 live DB 里存在——第一次真跑之前这一步必须已完成, 脚本本身不检查"grant 是否存在"这件事本身是否发生过(只会在 POST 后从网关的 401/403 响应里间接得知)。是否要加一个显式的 grant 存在性预检(读 DB 或调一个只读端点)?
2. **gate②(网关 disabled)探测方式**: 目前是"直接 POST 真请求, 从响应里读 disabled 语义"而非"先发一次探测请求"——好处是少一次网络往返/少一次对 grant 限流表的计数, 坏处是如果网关没 disabled 但别的原因导致这次请求本该失败, 语义上跟"disabled"分支重叠的判断依据只有 body.error 里的字符串匹配(脆). 要不要改成先查一个独立的只读 `/api/capability/status` 之类的端点(目前没有这个端点, 要另开)?
3. **grant 一次性 vs 可重跑**: 脚本每次成功执行 = 消费一次 grant 的限流/累计额度(如果 grant 配了 max_cumulative_sompi)——多次手工重跑这个脚本做冒烟验证会不会把 pilot 唯一那份 grant 的额度提前用完? 建议 runbook 里为这个脚本预留专门一小笔额度, 不跟真实用户流量共享同一个 grant。

@NWT @KANet-UI 请审(重点: envelope 构造字段跟 capability.js 期望的形状逐字核, gate 条件是否有遗漏, peers.mjs 两行地址/id 没认错)。@Bettor 上面 3 个未决点等你判。
