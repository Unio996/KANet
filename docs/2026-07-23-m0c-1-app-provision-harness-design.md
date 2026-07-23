# M0c-1 app provision 实战 harness 方案 — persona 端到端 armed=on 隔离实发（J2 主设计）

> **Status**: DRAFT v0.1（2026-07-23 · J2 出稿 → 待 Bettor 方向审 + NWT 核 → 才实施）
> **依据**: Owner 令"记得测试·迭代框架平替真人循环发现问题"（Bettor 编排 #x773rd）+ NWT GREEN 4 note（arm 前提①收口条件 = 代码 GREEN + 实战 harness + N2/N3 live 验）+ `docs/TEST-FRAMEWORK.md` 三原则。
> **性质**: 测试方案文档。不授权装载/arm/真钱移动；harness 全程隔离非 live。

---

## 1. 目标与硬 DoD

在**隔离环境**（armed=on + GRANT_ENVELOPE_IMPLEMENTED=true，非 live）对**真 relay 进程**实发命令，验 gate 五条（Bettor 编排）+ persona 端到端命令流（非单点单元测试）：

1. **合法业务流 allow**（真放行：回执是执行层结果/执行层错误，不是 gate deny）
2. **越 scope 拒**（超额度/收款人外/命令外/维度未授权）
3. **吊销即时拒**（operator revoke 后下条命令立即拒）
4. **伪签拒**（错钥签名 + 偷签名改字段族：nonce/relay/network/expiry/grant_id）
5. **掉包拒**（envelope.intent 与 cmd 执行字段不一致）

**PASS 标准**: 五条全 PASS + persona 流全程逐命令决策留痕（gate reason 原文入 evidence log）→ NWT 核结果 → 才置 `GRANT_ENVELOPE_IMPLEMENTED=true`（单行 commit，NWT 核 flip diff == harness 跑的那份）。任一 FAIL/走过场 = 不置 flag（Bettor 硬 DoD）。

## 2. 隔离架构（非 live 论证）

- **真 relay 进程**: harness 用 `fork('kasia-relay/src/relay.mjs')` 起独立 relay 子进程（与 relay-manager 同款 fork+IPC 拓扑 = 实发走 `process.on('message')` → validateCommandPayload → **authorizeCommand gate（§4.1 locus）** → switch，验的就是生产代码路径，非 mock gate）。
- **隔离 env**: `ADMIN_M0C1_GATE_ARMED=1` + `M0C1_GRANT_DB_PATH=<临时 DB>`（非 console.db）+ 一次性 throwaway `KASPA_PRIVKEY` + `RELAY_NODE_ID/NETWORK=harness 值` + `RELAY_MODE=indexer` + `CONSOLE_URL=''`（不挂 console）。
- **非 live 四证**: ①不重启 console/不触碰 live relay 进程 ②armed env 只进 harness 子进程（live relay 未重启读不到）③grant 临时 DB 与生产 registry 物理隔离 ④throwaway 钱包零资金 = transfer 类命令过 gate 后在执行层失败（无 UTXO/无 RPC），**执行层失败正是 allow 证据**（错误形态 ≠ `denied:true`）——NO TX NO STATE 天然守住。
- **flag 处理（透明化）**: harness 运行时对 authorize.mjs 施加**唯一一行临时改动**（flag false→true, 不 commit），run log 记录该文件 sha256; PASS 后的正式 flip commit 必须产生同一 sha256（NWT 核 = harness 跑的就是要装载的）。

## 3. persona 端到端（平替真人·Owner 令）

现有 personas 是 NL 对话人格（broker 域）；M0c-1 gate 是协议层——本 harness 给 test-framework 新增 **app-client persona 层**（协议人格 = 真实 app 的命令流行为模式，可复用给 M0c-2/M0c-3 harness）：

| persona | 模拟对象 | 命令流 |
|---|---|---|
| `app_legit`（诚实 app） | tg-mini-app 类真实应用 | get_pubkey(readonly 豁免)→send_message(scope 内)→transfer(payee+额度内)→再来一笔合法(重复业务) |
| `app_greedy`（越权 app） | 拿到窄 grant 想干大事 | 超额 transfer→scope 外收款人→未授权命令(sign_input_for_settle)→未授权维度(带 marketId) |
| `app_forger`（伪造者） | 偷到信封没偷到私钥 | 错钥重签→偷合法签名逐字段改(nonce/relay/network/expiry/grant_id 五变体) |
| `app_toctou`（掉包者） | 签小执行大 | envelope 签 1 KAS、cmd 塞 99 KAS；cmd 多带字段 |
| `app_revoked`（被吊销 app） | 出事后的 app | 合法一笔→operator 离线 revoke→同一 grant 下条命令(必须立即拒) |

**端到端**: 每 persona 是连续命令流（非孤立单发），gate 决策逐条断言 must 级；同一 run 内穿插 internal/operator/缺失 origin 命令验四值分支全谱（armed=on 下 internal 放行/缺失拒 = 断现网风险的镜像预演）。

## 4. 落点（框架迭代·边测边补）

```
test-framework/
├── lib/relay-gate-driver.mjs      ← 新: fork 真 relay + IPC send/await 回执(领域无关, M0c-2/3 复用)
├── lib/app-envelope-sdk.mjs       ← 新: 信封签发器(复用 app-envelope.mjs canonical/签名定义, 测试侧 SDK)
├── personas/app_clients.mjs       ← 新: 五 app-client 协议人格
└── cases/m0c1-gate/
    ├── legit-flow.test.mjs        ← 条1 + origin 四值谱
    ├── scope-violation.test.mjs   ← 条2
    ├── revocation-immediate.test.mjs ← 条3(真跑 provision 脚本 revoke)
    ├── forgery.test.mjs           ← 条4(错钥+五字段改签族)
    └── toctou-swap.test.mjs       ← 条5
```
跑法: `node scripts/test.mjs --domain=m0c1-gate`。provision 用真脚本 `m0c1-grant-provision.mjs`（gen-key/issue/revoke 全走 operator 路径 = 组件③一并实战）。

## 5. 诚实边界

- **入口层**: harness 在 relay IPC 边界实发（gate locus 所在）。app→HTTP 能力网关(机制A)尚未落码，网关强制覆写 origin='app' 的 HTTP 端到端归网关批 harness，本卡不假装覆盖。
- **N2/N3 arm 前 live 验** = NWT 域（本 harness 不替）；nonce durable 重放 = M0c-3（本 harness 只验"改 nonce 签名失效"，不验同 nonce 二发——诚实标 M0c-3 前窗口）。
- 乙路 TCB 继承：harness 证场景 A 拦截，不证抗 Console（禁用词表照旧）。

## 6. 交付物

① harness 代码（§4 六件）② evidence log（逐命令: 发什么/gate 决策/reason 原文/回执形态）③ 五条 PASS/FAIL 榜 + persona 流回放 ④ 框架迭代清单（跑中发现的 test-framework 不足当场补, 记录进 README）⑤ PASS 后 flip 单行 commit（sha256 对齐 harness run log）。

**关联**: `docs/2026-07-23-m0c-1-app-provision-design.md`（§6 负向测试）、批3 `kasia-relay/src/lib/authorize.mjs`、`docs/TEST-FRAMEWORK.md`、NWT verdict（app provision GREEN 4 note）。
