> **Status**: DRAFT — team review pending (Bettor + NWT + KANet-UI)

# G5 v2 B1-B6 安全加固设计稿

J2 2026-07-25。回应 Codex RESPONSE-20260725-G5-V2-COMMITTED-PARTIAL-CODEX-REVIEW.md（bridge
commit 待定，从 `coord/codex-bridge` fetch 到的最新 committed-increment 审查），verdict
`PARTIAL_PROGRESS_BLOCKED_DO_NOT_RUN_G5`，六条新阻塞 B1-B6。本稿不落码，先给设计供 team 审
（Bettor 指派：B1 小可直接落码但仍先并入本轮设计稿走审；B2/B4/B5/B6 实质设计；B3 deferred）。

Codex 原文已确认（`docs/2026-07-25-j2-g5-*` 系列 pending-review diff 是既有先例格式，本稿延续）:
`kasia-console/src/lib/admin-secret-tier.mjs` 的 `checkAdminSecretTier(request, envVarName,
headerName)` + `operator-settle.js` 的 `ADMIN_IP_ALLOWLIST` 环境变量模式，是本仓库既有的
"admin-tier + IP allowlist" 标准件（Codex 原文明确要求"preferably reuse"），本设计全程复用，
不新造机制。

---

## B1 — runtime-identity 端点服务端强制 loopback + admin-tier 鉴权

**现状**（`kasia-console/src/api/health.js`）：`GET /api/system/runtime-identity` 无条件对
任何能连到 Console 的请求返回 DB 绝对路径/PID/启动时间/commit——注释把"只有 loopback 调用方
会用它"这个信任完全托付给调用方（G5 自己客户端检查 host 是 loopback），服务端零防护。

**修复**（两层，镜像 `operator-settle.js` 现有模式，无需新造机制）：

```js
// health.js — /api/system/runtime-identity route handler 顶部
fastify.get('/api/system/runtime-identity', async (request, reply) => {
  // ① IP allowlist(默认 loopback-only, 跟 operator-settle.js 同款环境变量+默认值)
  const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',').map(s => s.trim());
  if (!ipAllowlist.includes(request.ip)) {
    return reply.code(403).send({ ok: false, error: `runtime-identity: source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST` });
  }
  // ② admin-secret tier(新 tier, 不复用其他端点的 secret——admin-secret-tier.mjs 头部注释明文
  //    "不再有单一 ADMIN_SECRET 兜底所有端点")
  const auth = checkAdminSecretTier(request, 'ADMIN_SECRET_RUNTIME_IDENTITY');
  if (!auth.ok) return reply.code(auth.code).send({ ok: false, error: auth.error });

  return reply.send(RUNTIME_IDENTITY);
});
```

**待team定的点**：新 tier `ADMIN_SECRET_RUNTIME_IDENTITY`（T-RUNTIME-IDENTITY）还是并入既有
`T-READONLY`（`ADMIN_SECRET_READONLY`，现由 visibility 翻转 + zk-close-gate-debugger 共用，
文档标注"零链上副作用"共享合理）？本端点虽也零链上副作用，但泄露的是文件系统绝对路径/PID
这类主机层信息，风险类别跟"翻转一个显示开关"不完全一样。我倾向新开专属 tier（更符合
admin-secret-tier.mjs 头部"每个端点认自己的 tier"的既定哲学），但这是低成本的判断题，team
拍板即可，不影响整体设计。

**G5 侧改动**：`verifyRuntimeIdentity()` 的 fetch 调用需要带上 header：
```js
const res = await fetch(`${CONSOLE_BASE_URL}/api/system/runtime-identity`, {
  headers: { 'x-kanet-admin-secret': process.env.ADMIN_SECRET_RUNTIME_IDENTITY || '' },
  signal: AbortSignal.timeout(8000),
});
```
secret 从 G5 自己的环境变量读（跟 `KASPA_RPC_URL` 同款调用惯例），运营者启动 G5 时必须同时
设置这个变量，否则 gate③ 会在 403/503 处 fail-closed（符合"未设=拒绝"既有铁律）。

**负测试**（并入 regression 套件）：非 loopback IP → 403；loopback 但缺/错 secret → 403/503；
两者都对 → 200 且内容不变。

---

## B2 — 启动冻结逐文件 digest manifest（取代/降级现有 git diff 等价判定）

**现状问题**：`RUNTIME_SCOPE_DIRS = ['kasia-console/src', 'kasia-relay/src', 'package.json',
'package-lock.json']`，G5 只用 `git diff --stat <package_commit> <runtime_commit> --
RUNTIME_SCOPE_DIRS` 判空即视为等价。这个判定基于**当前磁盘状态**跟 git 历史比较，证明不了
**进程实际加载进内存的字节**——进程可能是脏树启动后又被 revert 干净、或者启动时用的是
generated/未追踪文件，git diff 看不出这些。

**设计**：

1. 复用 `RUNTIME_SCOPE_DIRS` 同一份 scope 定义（不新造第二份清单，两处 import 同一个常量——
   建议把 `RUNTIME_SCOPE_DIRS` 提到 `kasia-console/src/lib/` 下的共享文件，G5 和 health.js
   都从那里 import，避免两份定义漂移，这本身也是这轮暴露的"两处各自维护同名概念"教训的直接
   应用，见 `[[reference-shared-source-verification-is-vacuous-even-if-independent-logic]]`
   记忆——但这次是反过来: 两处**不同**逻辑判同一件事必须共享同一份真值源，不能自己各自维护）。
2. 新增 `kasia-console/src/lib/load-bearing-digest.mjs`：
   ```js
   export function computeLoadBearingDigest(rootDir, scopeDirs) {
     const files = [];
     for (const scopePath of scopeDirs) {
       const abs = path.join(rootDir, scopePath);
       if (!existsSync(abs)) continue;
       if (statSync(abs).isDirectory()) walkFilesRecursive(abs, rootDir, files);
       else files.push(path.relative(rootDir, abs).split(path.sep).join('/'));
     }
     files.sort(); // 确定性: 排序后的相对 POSIX 路径
     const perFile = {};
     for (const f of files) {
       perFile[f] = createHash('sha256').update(readFileSync(path.join(rootDir, f))).digest('hex');
     }
     const treeDigest = createHash('sha256')
       .update(files.map((f) => `${f}:${perFile[f]}`).join('\n'))
       .digest('hex');
     return { treeDigest, perFile, fileCount: files.length };
   }
   ```
3. `health.js` 在模块加载时（跟 `RUNTIME_IDENTITY` 一起）调用一次，**在路由注册之前**完成
   （Codex R2 原文明确要求"captured before route registration"），结果并入
   `RUNTIME_IDENTITY.load_bearing_digest = { treeDigest, fileCount }`（`perFile` 太大不放进
   HTTP 响应主体，只在需要排障时另开一个受同样鉴权保护的 `/api/system/runtime-identity/files`
   端点按需查询）。
4. **dirty-state marker**：计算 digest 前先 `git status --porcelain -- <scopeDirs>`，若非空，
   `RUNTIME_IDENTITY.load_bearing_digest.dirty = true`（不阻止启动——Console 不该因为开发机
   脏树拒绝启动——但 G5 gate③ 看到 `dirty: true` 必须直接 fail-closed，不可比对）。
5. **G5 侧比对**：`--snapshot` 文件新增字段 `expected_load_bearing_tree_digest`（Owner/delegate
   批准 grant 时，用同一个 `computeLoadBearingDigest()` 对 accepted package commit 算一次，
   写进 snapshot）。gate③ 改成**逐字节比对** `ri.load_bearing_digest.treeDigest ===
   snap.expected_load_bearing_tree_digest`，不等直接 fail。**git diff 降级为 supplemental
   debug 输出**（比对失败时打印出来帮排查哪个文件不一致，不再是判定权威——跟 Codex 原文
   "Directory-level Git diff is supplemental, not the authority" 要求一致）。

**待team定的点**：`expected_load_bearing_tree_digest` 由谁在什么时候算/写进 snapshot——是
"生成 snapshot 的那个（目前还不存在的）operator 工具"的职责范围，这个工具本身也没设计过。
本稿只定 G5 消费端的比对逻辑，snapshot 生成端流程是另一块待补的设计（列进"未决"而非本稿
现在展开，避免范围失控）。

---

## B3 — deferred（无需本稿设计）

保持 Codex 原判：这是 re-activation 时机的 live-process 独立证据（真实重启后的 Console 打
真实 runtime-identity 端点，非本地 stub），本就是既有 entry-condition #8（"live-process
evidence only after explicit Owner authority"）覆盖范围，不是这轮能提前补的东西。

---

## B4 — journal 写入 crash-durable（fsync）

**现状**：`writeFileSync(tmp) → renameSync(tmp, dest)`，同文件系统内 rename 是 atomic 的（不
会出现"写了一半"的损坏文件），能扛进程被 kill；但没有 `fsync`，OS crash/断电时文件系统层
可能还没把这次写入落盘（页缓存丢失），能丢失或错序这个本该已经"prepared"的 journal 条目——
而 POST 可能已经真的发出去了（子进程被杀之前）。

**设计**（POSIX durable-write pattern，写 tmp 文件 fsync + rename + fsync 目录）：

```js
function durableWriteJournal(dest, obj) {
  const tmp = `${dest}.tmp-${randomBytes(4).toString('hex')}`;
  const fd = openSync(tmp, 'w');
  writeSync(fd, JSON.stringify(obj, null, 2));
  fsyncSync(fd); // 数据落盘, 非只在页缓存
  closeSync(fd);
  renameSync(tmp, dest); // atomic rename(已有行为不变)
  try {
    const dirFd = openSync(path.dirname(dest), 'r');
    fsyncSync(dirFd); // 目录项(rename 本身)落盘——POSIX 上这一步才真正保证崩溃后能看到新文件名
    closeSync(dirFd);
  } catch (e) {
    // Windows 开发机上目录 fd fsync 语义跟 POSIX 不同/可能报错——如实记但不 fail(见下方局限标注)
    console.error(`[durableWriteJournal] 目录 fsync 失败(非 fatal, 见已知局限): ${e.message}`);
  }
}
```

只用在 `prepared`（pre-POST，money-relevant 的第一个检查点）和 `submitted`（POST 后写回
txId）两个状态的写入，其余状态（`landed`/`failed`/`reconciled_*`）是事后收尾记录，crash 期间
丢失只影响审计便利性不影响资金安全（reconcile 脚本本就要处理 ambiguous 情况）。

**已知局限如实标注**：本仓库开发环境是 Windows；`fsyncSync` 在打开一个目录的 fd 这件事上
Windows/NTFS 跟 POSIX/ext4 语义不完全对等（Windows 目录本身不是常规可 fsync 的文件对象）。
真实部署目标（TN12 节点）需要确认是 Linux（合理推断，需要跟 Bettor/KANet-UI 确认部署环境
再定是否要加平台判断分支，或者干脆说明"crash-durable 设计以 Linux 部署为准, Windows 开发机
上这层保护退化但不影响本地测试有效性"）。这条不是我能凭猜测下定论的事，写进本稿的"待确认"
而非直接下结论。

**待team定的点**：真实部署环境是否是 Linux（决定目录 fsync 那段代码的实际保护力）；是否
接受"Windows 开发机上这层退化"这个已知局限（我倾向接受，本身不影响 Linux 生产环境的保护
效果，只是本地跑测试时少一层，跟 B4 本意不冲突）。

---

## B5 — governed reconcile：不可信单人断言释放预算的口子

**现状**：`resolve <id> --verdict not-spent --note "<自由文本>"`——`not-spent` 会把一条
`ambiguous`/`prepared`/`submitted` 记录标 `failed`，从累计预算里排除，**释放花费额度**。
`--note` 只是自由文本，没有绑定到任何可验证证据、没有记录是谁批准的、没有任何形式的复核。
一次判断失误或者一个被攻陷的 operator 就能重开花费额度——这是这一轮 B1-B6 里对钱路最直接
的风险点。

**设计**（`not-spent` 需要双人 + 证据摘要绑定；`spent` 保持单人但也要证据摘要，因为它不释放
预算风险低很多）：

```
node m0c1-g5-journal-reconcile.mjs resolve <id> --verdict not-spent \
  --evidence-file <path>      # 必需: 一个文件, 内容是判定 not-spent 依据的证据(RPC 查询原始
                               #   输出/UTXO 快照对比截图描述/等), digest 记进 journal, 文件本身
                               #   不内嵌(保持 journal 体积小), 但路径+digest 留痕可追溯
  --approver-1 <name> --approver-1-note <text>   # 第一位批准人 + 该人的判断陈述(自由文本但
                                                  #   绑定具体人名, 不是匿名 note)
  --approver-2 <name> --approver-2-note <text>   # 第二位批准人, 必须跟 approver-1 姓名不同
                                                  #   (脚本层面硬校验 approver-1 !== approver-2,
                                                  #   不能同一人填两遍蒙混)
```

```js
// reconcile 脚本 resolve 子命令(not-spent 分支新增校验)
if (verdict === 'not-spent') {
  if (!evidenceFile || !existsSync(evidenceFile)) fail('not-spent 判定必须提供 --evidence-file(可读文件)');
  if (!approver1 || !approver2) fail('not-spent 判定必须提供 --approver-1 和 --approver-2 两个不同的批准人');
  if (approver1 === approver2) fail('--approver-1 和 --approver-2 不能是同一人(双人复核要求两个独立视角)');
  const evidenceDigest = createHash('sha256').update(readFileSync(evidenceFile)).digest('hex');
  entry.reconciled_evidence = { evidence_file: evidenceFile, evidence_digest: evidenceDigest };
  entry.reconciled_approvers = [
    { name: approver1, note: approver1Note, at: nowIso() },
    { name: approver2, note: approver2Note, at: nowIso() },
  ];
}
```

`spent` 分支（不释放预算，只是把 ambiguous 标成"已确认真花了"归档）保持单人 + 单条
`--evidence-file`（证据摘要仍然要，只是不要求双人）。

**诚实局限**：这不是密码学意义上的"双人授权"（没有签名，approver 姓名只是自由文本字段），
是本地单机 CLI 工具能做到的最大化审计留痕——真正的强约束（比如要求两个物理上不同的人各自
用各自的密钥签一次）超出这个 pilot 阶段单人操作 CLI 的现实场景。这条如实写进设计稿而非
包装成比实际更强的机制，符合 Codex 反复强调的"不能自我声明 GREEN，只能提供可验证证据"原则。
`--authorized-by <Owner或委派标识>` 这个 Codex 提到的字段，本稿建议做成 `--approver-1/-2`
的姓名字段本身承担这个角色（谁填的名字就是谁的授权声明），不单独加一层，避免过度设计。

**待team定的点**：`approver-1`/`approver-2` 的姓名字段要不要限制成一个白名单（比如只能填
Bettor/NWT/KANet-UI/Owner 这几个已知身份，防打错字/防随便填个假名字）？我倾向加（低成本，
`ALLOWED_APPROVER_NAMES` 常量白名单校验），但这是可以后补的加固，不阻塞本稿其余部分。

---

## B6 — 不可变证据包（这次 committed increment 的最终提交物）

**现状问题**：Codex 原文"Do not infer GREEN from comments or design notes"——散落在多个
commit message/pending-review doc 里的声明，Codex 没法一次性验证"这个 commit 到底测了什么/
测出了什么结果"。

**设计**：新增一个生成脚本（而非手写 JSON，跟 `docs/evidence/2026-07-25-live-console-db-
schema-currency-evidence.json` 已有先例一致——那份是手动生成的一次性 artifact, 这次做成脚本
化、可重跑复现）：

```
node kasia-console/scripts/m0c1-g5-generate-evidence-bundle.mjs > docs/evidence/<date>-g5-v2-bX-evidence.json
```

内容结构：
```json
{
  "generated_at": "<ISO>",
  "source_commit": "<git rev-parse HEAD>",
  "changed_paths": ["kasia-console/src/api/health.js", "..."],
  "content_digests": { "<path>": "<sha256>", "...": "..." },
  "m0a_manifest_entries_referenced": ["G5-realchain-smoke-dbreadonly", "TFW-g5-real-chain-smoke-regression"],
  "regression_test_run": { "pass": 31, "fail": 0, "ran_at": "<ISO>", "ran_in": "clean git worktree at <sha>" },
  "regression_evidence_file": "logs/test-runs/g5-real-chain-smoke-regression-latest.json"
}
```

这个脚本在 regression 套件真跑出全绿之后手动调用一次，生成的 JSON 连同 regression 自己写的
`logs/test-runs/*-latest.json`（已存在，本次不用新造）一起提交，Issue #5 的 review request
直接引用这个 evidence bundle 文件路径，Codex 可以直接读，不用东拼西凑散落的 commit message。

**待team定的点**：这个脚本本身算不算又一个需要 M0a 治理的"写文件"动作？我认为不算——它只
写 `docs/evidence/` 下的证据 JSON，不碰 DB/关系不到 money-path 执行路径，跟现有其他生成
evidence 文件的脚本（如果有）同等对待，但如果 team 觉得应该也纳管，加一条 exception 也是
低成本的事。

---

## 落地顺序建议

B1（小，唯一没有"待team定"未决项的，可以设计过审后立刻单独先落码+负测试）→ B2（依赖
`RUNTIME_SCOPE_DIRS` 提取共享，其余相对独立）→ B4（独立，不依赖其他）→ B5（独立，不依赖
其他，但对钱路风险面最大，建议提前优先级）→ B6（收尾脚本，依赖前面都完成才有真数据可打包）。

四项里我建议 B5 > B1 > B4 > B2 的优先序（B5 直接把最大的"单人释放预算"缺口堵上；B1 便宜且
把裸暴露的信息面先关上；B4/B2 都是纵深加固，B2 涉及提取共享 scope 常量+snapshot 生成端流程
待补，工作量相对最大，放最后）。这只是我的建议排序，不是既定结论，team 审时可以调整。

---

## 需要 team 回答的问题汇总（不阻塞本稿本身，供 review 时逐条过）

1. B1: 新 tier `ADMIN_SECRET_RUNTIME_IDENTITY` 还是并入既有 `T-READONLY`？
2. B2: snapshot 生成端流程（谁在什么时候算 `expected_load_bearing_tree_digest` 写进
   snapshot）——这是本稿故意没展开的一块，需要单独立项还是这次一起做？
3. B4: 真实部署环境是否是 Linux？确认后决定目录 fsync 那段代码的实际保护力评估。
4. B5: approver 姓名字段要不要加白名单？
5. B6: evidence-bundle 生成脚本要不要走 M0a 治理？

Bettor/NWT/KANet-UI review 后我按裁定结果开始落码（B1 优先，其余按上面建议顺序或 team 重排
的顺序）。containment(unarm) 保持跟这条工作完全独立，等 Owner 授权。
