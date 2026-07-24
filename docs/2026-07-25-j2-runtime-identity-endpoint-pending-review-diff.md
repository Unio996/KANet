# J2 · runtime-identity 端点 pending-review diff

> **性质**: pending-review 工件（供 NWT+KANet-UI 审），working tree 实际改动未 committed（`git diff` 可直接核）。
> **依据**: Codex `RESPONSE-20260725-MSG131` P0-2（G5 real_chain smoke 重设计第一块，独立走审——它是身份判定的唯一权威来源，喂进 money-path），Bettor 最终 sign-off（`#zkip4w`）授权开工。

## 背景

G5 v2 重设计（scratch/j2-g5-v2-redesign-design.md，NWT+KANet-UI 双 GREEN）P0-2 需要一个方式证明"打的是真在 serving `G5_CONSOLE_BASE_URL` 那个进程"，而不只是查 G5 自己 checkout 的本地 `git rev-parse HEAD`（那证明不了 target 进程实际跑的是什么）。

## 改动

### `kasia-console/src/db/client.js`（+1 行）

`dbPath` 加进 export（原来只在模块内部用）。NWT 硬要求：新端点必须 import 复用这个已 resolve 好的值，不能自己再 parse 一遍 `process.env.DB_PATH`（同 CUSTODIAL_RELAY_ID/pilot-wallet-policy 那个"两处各自解析漂移"教训的第三次应用）。`encrypt`/`decrypt`/`sqlite`/`db` 等既有导出/逻辑一字未动。

### `kasia-console/src/api/health.js`（新增 `GET /api/system/runtime-identity`）

- `computeRuntimeIdentity()`：模块加载时（进程启动早期）立即算一次并缓存为 `RUNTIME_IDENTITY` 常量——不是每次请求现查。目的：证明"这个进程从哪个 commit / 哪个 db 文件启动"，全进程生命周期不变；进程活着期间 working tree 再被后续 commit 改动不该污染这个读数。
  - `git_commit`：`execFileSync('git', ['rev-parse','HEAD'], {cwd: ROOT})`，ROOT 从本文件路径反推（`../../../..`）。
  - `db_path`：直接用 import 的 `dbPath`（client.js 已 resolve 好的值，非重新 parse）。
  - `db_stat`：`fs.statSync(dbPath)` 取 `{dev, ino}`——KANet-UI 建议 + Bettor 采纳的加固，NTFS 上 `ino` 也是文件系统内有意义的唯一标识，比纯路径字符串比对强一档，成本≈零。
  - `pid`/`started_at`：辅助诊断字段。
- 端点本身：零鉴权只读零副作用（不碰任何钱/密钥），返回 `RUNTIME_IDENTITY` 原样。**不做 host 校验**——loopback-only 强制是调用方（G5）的责任，本端点只负责如实报告。
- 已知局限（如实标注，非隐藏）：`db_stat` 不覆盖 `package.json`/`node_modules` 依赖变更（这块由 G5 侧 `RUNTIME_SCOPE_DIRS` 的 git diff 检查覆盖，见 G5 重设计稿）、不跨机器/跨挂载点比对（单机单挂载点场景够用，多机部署需要更强机制，留待以后）。

## lint

`node scripts/lint-kanet.mjs kasia-console/src/api/health.js kasia-console/src/db/client.js` — 0 errors。纯路由文件，无裸 DB/relay-manager import，不触发 M0a 门。

## 自测

`node -e` 独立跑过 `execFileSync('git',...)` + `statSync(dbPath)` 两段核心逻辑（不经过完整 health.js 模块 import，避免顺带跑 `getConfig`/`computeAllHealth` 依赖链）——`git_commit` 返回当前真实 HEAD（`2aaf9a0...`），`db_stat` 返回真实 `{dev, ino}` 值，逻辑正确。**未重启 live Console 实测端点本身**（主 console 重启是全系统 blast radius 操作，containment/unarm 决策还悬着，不该在这个节点再自行触发一次重启——这条留到 G5 全套改完+containment 决完后统一验证）。

## 待你们审的点

无新未决点（3 个此前已定案的点在 G5 主稿里，不在这份小 diff）。

@NWT @KANet-UI 请审（重点：db_path 确实 import 而非重新 parse、db_stat 字段格式、无 host 校验的边界说明是否清楚）。
