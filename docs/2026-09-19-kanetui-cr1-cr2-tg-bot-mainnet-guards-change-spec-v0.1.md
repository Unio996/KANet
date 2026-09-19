# CR-1 / CR-2 变更说明：tg-bot 启动器与托管钱包路由的主网 fail-closed 守卫 v0.1（只写不落码）

> **Status**: CURRENT
>
> 🔴 **状态注记（2026-09-19 · KANet-UI · 出处 `docs/DECISIONS.md` D-024）：搁置——Owner 裁定"暂停电报接线，等 v0 API 立项"。CR-1 / CR-2 / CR-3 均不落码、不建 worktree。复启须对着当时代码重核，不能直接照做。** 正文未改，保留为搁置参照；其中行号为 2026-09-19 当时值。
>
> 起草 KANet-UI · 2026-09-19 · 出处：Bettor 对 `docs/2026-09-19-kanetui-mainnet-tg-bot-wiring-runbook-v0.1.md`（下称 runbook）§0 B-1 / B-2 的裁定（对等消息，账本记录待补）。
>
> **执行门**：① 本页 → **NWT 审** → GREEN 后才落码；② 落码**只在独立 worktree**（`scratch/_kanetui_wt_tgbot-cr`，基于生产检出当前 HEAD 的侧分支），**不在生产检出 `D:\kanet-tn12` 改任何文件**；③ 合入主线与推送由 Bettor 执行；④ 主网上启动 bot 仍须 runbook 的 Owner 开闸，本页与之无关。
>
> **范围**：仅 CR-1（`_launch_tg_bot.mjs`）与 CR-2（`tg-wallet.js`）。**CR-3**（bot `/link` 正则 + console `link.js` 前缀校验，用户面）归 Owner 批，不在本页。
>
> **D-021**：本页无密钥值、地址、余额。

## 0. 一句话

两处改动都是**收紧**：CR-1 让 bot 启动器不再读 TN12 密钥文件、不再写死 TN12 目标，并在环境不对时**拒绝启动**；CR-2 让托管钱包三条路由在 console 网络与代码写死的网络不符时**返回 503**。**不新增任何能力，不开放任何钱路。**

## 1. CR-1 — `_launch_tg_bot.mjs`

### 1.1 现状（生产检出，行号为起草时）

| 行 | 内容 | 问题 |
|---|---|---|
| 6 | `import { readFileSync } from 'node:fs'` | 仅为读 env 文件 |
| 8-13 | 读 `../kanet.env` 解析成 `kv` | 读 TN12 密钥文件；TN12 目录清理后直接抛错 |
| 16-18 | 用 `kv.CONSOLE_ENCRYPTION_KEY` 覆盖进程变量，再 `import configs.js` 解 `ingest_secret` | TN12 密钥解主网库；且让 bot 进程持有 DB 加密密钥 |
| 20-22 | 用 `kv` 覆盖 `TELEGRAM_BOT_TOKEN` / `USERNAME` / `INGEST_SECRET` | 覆盖掉 `tg-bot-manager.js:74` 注入的主网值 |
| 23 | `BROKER_RELAY_ID` = TN12 broker-1 UUID | 主网库无此 relay |
| 24-25 | `CONSOLE_URL` = `:3200`；`KASPA_NETWORK` = `testnet-12` | 指向已下线目标 / 错网络 |
| 27-29 | 启动日志写死 `broker=15593e10(broker-1) console=:3200` | 日志本身也在说谎 |
| 31-32 | `import bot.mjs` → `startBot()` | 保留 |

### 1.2 改法（精确到形态）

**新增** `kasia-console/src/lib/tg-bot-launch-env.mjs`（纯函数，无 I/O，便于单测；不 import 任何 DB 模块）：

```js
// resolveBotLaunchEnv(env) → { ok: true, consoleUrl, scrub: [键名...] }
//                          | { ok: false, problems: [ "描述（只含键名/期望/非密钥值）" ... ] }
```

规则（全部 fail-closed，任一不满足 ⇒ `ok:false`，且 `problems` **只含键名，不含任何密钥值**）：

| # | 断言 | 不满足时 problems 里写 |
|---|---|---|
| a | `env.KASPA_NETWORK === 'mainnet'` | `KASPA_NETWORK 必须为 mainnet（实际: <该值>）`（网络名非密钥，可打印） |
| b | `env.PORT` 是 1–65535 的整数字符串；推导 `consoleUrl = 'http://127.0.0.1:' + PORT` | `PORT 缺失或非法` |
| c | 若 `env.CONSOLE_URL` 已设，必须**等于**推导值 | `CONSOLE_URL 与本机 console 端口不一致（实际: <URL>）`（拦住继承来的 `:3200`） |
| d | `env.INGEST_SECRET` 非空 | `INGEST_SECRET 缺失`（只说缺，不回显） |
| e | `env.TELEGRAM_BOT_TOKEN` 非空 | `TELEGRAM_BOT_TOKEN 缺失` |
| f | `env.KANET_TESTNET_NO_LIMITS` **未设** | `KANET_TESTNET_NO_LIMITS 不得出现在主网环境`（runbook §8 的运行时第二道；bot 继承自 console 环境，console 若带着它这里能抓到） |

`scrub`（要从 bot 进程环境里**删掉**的键名）：`CONSOLE_ENCRYPTION_KEY`、所有匹配 `/^ADMIN_SECRET/` 的键、`RELAY_KEY_EXPORT_ENABLED_UNTIL`。理由：bot 是 **0-key / 0-custody** 进程（`tg-bot/config.mjs` 头注释），`tg-bot/*.mjs` **不 import 任何 console 代码**、只读 `config.mjs` 里列的那批 env（实核：无其他 `process.env` 读取点），它既不需要 DB 加密密钥也不需要 admin 密钥；`fork` 时 `{...process.env}` 会把它们全带进去（`tg-bot-manager.js:74`），纯属多余的暴露面。**不用白名单方案**（只保留已知键、删其余）：Windows 上删 `SystemRoot` 等系统变量可能让 DNS/TLS 行为异常，风险大于收益；黑名单只删已知敏感键。

**改** `_launch_tg_bot.mjs`：删除第 6、8–25、27–29 行；改为

```js
// 伪代码形态（落码时以实际 diff 为准）
import { resolveBotLaunchEnv } from './src/lib/tg-bot-launch-env.mjs';
const r = resolveBotLaunchEnv(process.env);
if (!r.ok) { console.error('[launch] FATAL:', r.problems.join('; ')); process.exit(1); }
process.env.CONSOLE_URL = r.consoleUrl;
for (const k of r.scrub) delete process.env[k];
console.log(`[launch] network=mainnet console=${r.consoleUrl} token=set ingest_secret=set scrubbed=${r.scrub.length}`);
// 原第 31-32 行不变：import bot.mjs → await startBot()
```

- `TELEGRAM_BOT_TOKEN` / `USERNAME` / `INGEST_SECRET` **不再覆盖**：直接用 `tg-bot-manager.js:74` 注入的（token/username 来自 DB 配置，`INGEST_SECRET` 来自 console 自己的 `process.env`——`index.js:569` `ensureIngestSecret()` 在 `:636` `startTgBotIfConfigured()` 之前执行，故 fork 时已存在）。
- `BROKER_RELAY_ID` **不再设置**：bot 的 broker 身份走 DB 配置（`config.mjs:37`），env fallback 留空。
- 启动器**不再打开 DB**（原来 import `configs.js` 会开库）。
- 启动日志**只打印键名与状态**，不打印任何值（`network`、`consoleUrl` 非密钥）。

### 1.3 不改

`tg-bot/config.mjs` 的 `:3200` / `testnet-12` 默认值（用户面 `tg-bot/*.mjs`，须 Owner 批；有上面 a/c 断言兜底，启动器保证到达 bot 时这两个值已被显式覆盖为正确值）；`_launch_owner_bot.mjs`（本次不起 owner-bot，见 runbook §3.5，它仍写死 TN12，**保持现状且在主网上不应被启动**）；`kanet-start.sh`（TN12 路径按 OQ-4 接受失效）；`tg-bot-manager.js`。

## 2. CR-2 — `kasia-console/src/api/tg-wallet.js`

### 2.1 现状

`:27` `const NETWORK = 'testnet-12'`；`:25` `AUTH`（只含 ingest-secret 校验）；三条路由挂 `AUTH`：`:57` `POST /api/tg-wallet/create`、`:86` `GET /api/tg-wallet/:tg_user_id`、`:152` `POST /api/tg-wallet/:tg_user_id/send`；`:112` `GET .../diagnose` 另有 `ADMIN_DIAGNOSE_ENABLED` + tier 密钥 + IP allowlist 三重门，不挂 `AUTH`。

### 2.2 改法

在 `:27` 之后新增一个 preHandler，并把它排在 ingest 鉴权**之后**（未鉴权请求仍先得 401，行为不变）：

```js
// 伪代码形态
const NETWORK_GUARD = async (_req, rep) => {
  const actual = process.env.KASPA_NETWORK;
  if (actual !== NETWORK) {
    return rep.code(503).send({ ok: false, error: `托管钱包暂不可用：本模块仅支持 ${NETWORK}，当前 KASPA_NETWORK=${actual || '(未设)'}` });
  }
};
const GUARDED = { preHandler: [...AUTH.preHandler, NETWORK_GUARD] };
// 三条路由由 AUTH 改为 GUARDED；diagnose 不动
```

- 判据是**严格相等**：`KASPA_NETWORK` 未设也 503（fail-closed）。
- 守卫在**任何 DB 读写、RPC、助记词生成之前**触发；因此 503 时 `tg_custodial_wallets` 不新增行、不生成助记词、响应体不含 `mnemonic`。
- **不**把 `NETWORK` 改成 env 驱动、**不**放宽 `/send` 的地址正则（那是"启用主网托管钱包"，须 Owner 批，另议）。
- TN12 console（`KASPA_NETWORK=testnet-12`）行为**完全不变**（TN12 已退役，仅为回归对照）。

### 2.3 触及的现有测试

`kasia-console/test-framework/cases/m0c1-gate/tg-wallet-pilot-isolation-regression.mjs` 走真 Fastify inject 调这三条路由；改后若其 harness 环境里 `KASPA_NETWORK` 不是 `testnet-12` 会全部 503。落码时须核它的环境并**只在其 harness 设置处**补 `KASPA_NETWORK='testnet-12'`（一行），再重跑该 case 取证据；不改其断言。

## 3. 测试怎么证（每条都带负向与正向对照臂，避免"绿灯无信息"）

### 3.1 CR-1 — 新增 `kasia-console/src/lib/tg-bot-launch-env.test.mjs`（纯函数，同 `admin-secret-tier-key-export.test.mjs` 手法：`node src/lib/tg-bot-launch-env.test.mjs`）

| 用例 | 期望 |
|---|---|
| 全部正确（`KASPA_NETWORK=mainnet`、`PORT=3202`、`INGEST_SECRET`/`TOKEN` 非空） | `ok:true`、`consoleUrl=http://127.0.0.1:3202`（**正向对照臂**：证明断言不是恒失败） |
| `KASPA_NETWORK=testnet-12` / 未设 | `ok:false`，problems 含 `KASPA_NETWORK` |
| `PORT` 未设 / `abc` / `0` / `70000` | `ok:false`，含 `PORT` |
| `CONSOLE_URL=http://127.0.0.1:3200`（继承来的陈值）而 `PORT=3202` | `ok:false`，含 `CONSOLE_URL` |
| `CONSOLE_URL` 已设且等于推导值 | `ok:true`（对照臂） |
| `INGEST_SECRET` 空 / `TELEGRAM_BOT_TOKEN` 空 | `ok:false`，含对应键名 |
| `KANET_TESTNET_NO_LIMITS=1` | `ok:false` |
| **不泄露**：对上述所有失败用例，把 `INGEST_SECRET`/`TOKEN` 设成哨兵串（如 `SENTINEL-…`），断言 `JSON.stringify(problems)` **不含**该哨兵串 | 通过 |
| `scrub` 含 `CONSOLE_ENCRYPTION_KEY`、`ADMIN_SECRET_FUNDS`、`ADMIN_SECRET_ZK_STATE_PREP`（构造 env 里有这些键）；不含 `PORT` / `KASPA_NETWORK` | 通过 |

### 3.2 CR-1 — 启动器进程级（隔离，不碰生产 console；对应 runbook §7 Stage A）

在独立 worktree 里 `spawnSync(node, ['_launch_tg_bot.mjs'])`，注入受控 env（**假 token、不联网**：用 `KASPA_NETWORK=testnet-12` 等**必然失败**的组合，不会走到 `startBot()`，因此不会碰 Telegram）：断言 `exit code = 1`、stderr 含 `[launch] FATAL` 与键名、且 stdout+stderr **不含**哨兵值。另加静态断言：`Select-String _launch_tg_bot.mjs 'kanet\.env|3200|testnet-12|BROKER_RELAY_ID'` = 0 命中。**通过路径（`ok:true` 之后真的起 bot）本页不在自动测试里跑**——它会连 Telegram；由 runbook Stage B 的 B4/B5 在主网开闸后取证。这是**已知缺口，明示而非掩盖**。

### 3.3 CR-2 — 新增 `kasia-console/src/api/tg-wallet-network-guard.test.mjs`

手法同 `t-loopback-authz-funds-hotfix.test.mjs`：隔离库（`DB_PATH` 临时 + 真 migration）+ 真 Fastify 实例 + `inject`；`setConfig('ingest_secret', …)` 让鉴权通过（不绕过鉴权测业务）；throwaway `CONSOLE_ENCRYPTION_KEY`。

| 用例 | 期望 |
|---|---|
| `KASPA_NETWORK=mainnet`：`POST /create` / `GET /:id` / `POST /:id/send`（带正确 ingest secret） | 均 **503**，body 含 "托管钱包暂不可用"，**不含** `mnemonic`；`tg_custodial_wallets` 行数仍 0 |
| `KASPA_NETWORK` 未设：同上 | 均 503 |
| **顺序对照**：`KASPA_NETWORK=mainnet` 且**不带** ingest secret | **401**（鉴权先于守卫，证明守卫没有改变未鉴权行为） |
| **正向对照臂**：`KASPA_NETWORK=testnet-12`，`POST /create` | **200 且 `created:true`**（证明 503 来自守卫，不是路由本身坏了） |
| **正向对照臂**：`KASPA_NETWORK=testnet-12`，`POST /:id/send`（`CUSTODIAL_RELAY_ID` 未设） | 503 但 error 文案是 "转账暂不可用 (CUSTODIAL_RELAY_ID 未配)"（**与守卫文案不同**，证明守卫放行后由既有闸接管） |

### 3.4 其它证据

- 重跑 `tg-wallet-pilot-isolation-regression.mjs`（§2.3），保留 `logs/test-runs/<case>-latest.json`（覆盖式，仅最后一次——已知，本仓无自动回归，证据是**交付那一刻**的）。
- `node scripts/lint-kanet.mjs <changed-files>`；新文件**不裸 import `better-sqlite3`**（M0a 门只在 staged diff 跑）；测试拿 DB 用 `DB_PATH` 临时库 + `import client.js`。
- 交付时贴：两个新测试与重跑 case 的通过输出（含负向与对照臂各自的读数）、lint 输出、`git diff --stat`。

## 4. 落码流程（NWT GREEN 之后）

1. `git worktree add scratch/_kanetui_wt_tgbot-cr -b kanetui/tg-bot-mainnet-guards <生产检出当前 HEAD>`；**不在生产检出切分支**。依赖处理遵守 ANTI-PATTERNS 规则 81 与 `docs/2026-09-14-kanetui-worktree-junction-gate-mechanical-design-v0.1.md`：只允许 `internal` 型 junction，**禁止 `node_modules` 链回生产检出**（删 worktree 会顺链删进主树）；落码前跑 `node scripts/check-worktree-junctions.mjs`。
2. **两笔提交**：CR-1（3 个文件：启动器、新 lib、新 test）、CR-2（3 个文件：`tg-wallet.js`、新 test、pilot-isolation harness 一行）；同一文件不跨两笔，避免 hunk 混淆；提交前 `git diff --cached --stat` 对清单。
3. **不推送**；把分支头 commit 与证据交 NWT 复审，GREEN 后交 Bettor 合入。
4. **生效方式不同**：CR-1 **不需要**重启 console——启动器每次 `fork` 都从磁盘读。CR-2 **需要**重启 console 才生效——`tg-wallet.js` 是 console 进程内已加载的模块，合入磁盘不改变运行中进程的行为。⇒ **runbook 路径 X"不为 bot 重启 console"的收益被 CR-2 部分抵消**：CR-2 合入后须有一次 console 重启，**在它生效前，`/wallet` 在主网上仍是 B-2 的行为**，所以 bot 开闸必须晚于那次重启。这次重启的时机与窗口由 Bettor 排（可与下一次本来就要做的重启合并，如 v210 迁移随重启落地那次）；重启本身走 runbook §7 的六步与"先 quiesce ingress/timers"纪律，不在本页展开。

## 5. 回滚

侧分支未合入前：删 worktree 与分支即可，生产零影响。合入后：`git revert` 对应提交；CR-1 回退后 bot 仍不可在主网启动（回到 B-1 状态），CR-2 回退后 `/wallet` 回到 B-2 状态——两者都是"回到今天"，没有新增风险。

## 6. 请 NWT 重点看的三点

1. `scrub` 黑名单是否漏了 bot 不该持有的键（除 `CONSOLE_ENCRYPTION_KEY`、`ADMIN_SECRET*`、`RELAY_KEY_EXPORT_ENABLED_UNTIL` 外，`fork` 继承的还有 `INGEST_SECRET`——bot **需要**它，保留）。
2. 断言 c（`CONSOLE_URL` 必须等于按 `PORT` 推导值）是否过严：它拒绝任何"bot 指向非本机 console"的配置，本页认为在主网上这正是想要的。
3. 断言 f（运行时检测 `KANET_TESTNET_NO_LIMITS`）放在 bot 启动器里是否合适——它是 runbook §8 shell 侧断言的第二道，但 bot 本身并不读这个键。
