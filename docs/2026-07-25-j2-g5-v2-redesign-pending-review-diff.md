# J2 · G5 v2 全面重写 pending-review diff（Codex RESPONSE-20260725-MSG131 6 P0 + 3 P1）

> **性质**: pending-review 工件（供 NWT+KANet-UI code review），working tree 实际改动未 committed（`git diff` 可直接核）。
> **依据**: Codex verdict `BLOCKED_DO_NOT_RUN_G5`，设计稿 `scratch/j2-g5-v2-redesign-design.md`（双 GREEN），Bettor 最终 sign-off `#zkip4w`。

## 背景

v1（commit `d725000c`）被 Codex 判定"结构性缺口, 非小补丁能过": 6 个 P0（身份绑定/原子锁/原子 journal/精确快照绑定）+ 3 个 P1。本次是全面重写，不是增量补丁。依赖 `GET /api/system/runtime-identity`（已 ship，commit `a7aeb28d`）。

## 逐条对应 Codex MUST-FIX

- **P0-1（canonical DB bypass）**: `--db` CLI 参数**已移除**（不再存在这个选项）。db 路径永远来自 `verifyRuntimeIdentity()` 读到的 `runtime-identity` 端点权威值（`ri.db_path`），后续所有 DB 操作（schema currency 检查、grant 预检）统一用这一个值。
- **P0-2（进程身份未证）**: `verifyRuntimeIdentity()` 强制 `CONSOLE_BASE_URL` host 必须是 `127.0.0.1`/`localhost`（拒绝其他值），查询 `runtime-identity` 端点，`git_commit`/`db_stat` 为 `null` 时视为身份证明失败直接 abort（不是"某字段缺失但其他检查还能过"——NWT 明确要求）。
- **P0-3（package 身份矛盾）**: external harness 模型冻结。运行时 commit 与 snapshot 声明的 `package_commit` 不逐字相等时，跑 `git diff --stat <package_commit> <runtime_commit> -- RUNTIME_SCOPE_DIRS`（`kasia-console/src`+`kasia-relay/src`+`package.json`+`package-lock.json`），空 diff 视为 runtime-equivalent 放行，非空则真拒。两层证据（进程自证 + 磁盘等价）缺一不可，设计稿已展开论证。
- **P0-4（预算竞态）**: `acquireLock()` 用 `fs.openSync(LOCK_PATH,'wx')`（O_EXCL 原子创建）。拿不到锁直接 abort 打印现存锁内容，不自动清理不自动重试。
- **P0-5（广播后漏计）**: `journalWriteAtomic()`（写临时文件+`renameSync`，原子写惯用法）。POST 前写 `prepared`；POST 响应后立刻更新 `submitted`+txId（先于落链轮询）；`sumSpentKasAndFindAmbiguous()` 扫全部 journal，`prepared`/`submitted`/`ambiguous`/`landed` 全部计入累计（不再只算 `landed`）；**损坏/不可解析 journal 文件直接 `fail()` halt 整个门**（不是 v1 那个 `catch{}` 静默跳过——这是 Codex 明确点名的 fail-open bug）。
- **P0-6（授权快照未精确绑定）**: `loadAndVerifySnapshot()` 新增必传 `--snapshot <path>`。每个字段（`grant_id`/`app_key_id`/`relay_id`/`candidate_address`/`payee_address`/`network`/`max_amount_sompi`/`valid_until`/`package_commit`/`db_path`）从快照读, `source_scope`/`payee_scope`/`relay_scope` enforce 长度必须 `===1`（singleton scope）, `allowed_commands` 必须逐字符 `=== ['custodial_transfer']`。
- **P1-1（金额浮点）**: `kasToSompiBigInt()` 只接受 `^[0-9]+(\.[0-9]{1,8})?$` 正则匹配的 canonical decimal 字符串, 手算 BigInt（同 `m0c1-grant-provision.mjs` 的 `kasToSompiInt()` 惯用法), 不过 `Number()`/浮点。
- **P1-2（私钥文件卫生）**: `readPrivKeySafely()` 拒绝 repo 根目录树下的路径, `lstatSync().isSymbolicLink()` 拒绝 symlink, 读完立刻 `appPrivHex = null` 释放引用（Windows 权限强保证能力有限, 如实标注非 POSIX 强保证)。
- **P1-3（ambiguous 落链处理）**: 轮询 20 次未到 `minDepth=20` → journal 标 `ambiguous`（非 `failed`）。`gate⑦` 里 `ambiguous.length > 0` 直接 `fail()`——重跑前必须先 reconcile 未确认的 txId, 不能当普通失败重跑。

## Gate 序列（v1 4 个 → v2 8 个）

①working tree clean ②授权快照 ③运行时身份双层证据 ④live DB schema currency ⑤余额 ⑥OS 原子锁 ⑦累计预算护栏+ambiguous reconcile 检查 ⑧`--confirm`。

## M0a 影响

`await import('better-sqlite3')` 从 v1 的 2 处（`schemaCurrencyCheck`/`grantPreCheck` 各一个 import 语句）合并成 1 处（`main()` 内 import 一次, `Database` 构造器复用两处）。manifest `G5-realchain-smoke-dbreadonly` 条目需要更新: `count` 2→1、`content_digest` 更新为新 sha256（`be05567576f8679a8a89a0320540073692dabd6808fa2c4f1228c00aea499911`）、`review_ref` 待 NWT 这轮新审出的 token（v1 的 `3ac79de1` 不能延用——内容改动幅度太大, 不是 cosmetic）。

## lint

`node scripts/lint-kanet.mjs .../g5-pilot-custodial-real-chain-smoke.mjs` — syntax OK + 0 errors（M0a 门本身因 manifest 现有 count=2 allowance 仍 >= 实际 1 处, 暂时不报违规, 但 digest 需要真走审后再更新, 不能就这么算过审——manifest 更新 + commit 会跟 NWT review_ref 一起落, 不提前动）。

## 未做的事（如实标注）

- **runtime-identity 端点尚未在活的 Console 进程里实测**（同 `a7aeb28d` 那份 pending-review 的已知状态——留到 containment/统一重启时验证, 不为这个提前触发系统重启）。
- **没有写新增测试**（本 diff 只是重写主体；测试（锁竞争/坏 journal/kill-after-POST 恢复/精确授权绑定/错 DB/错进程身份）是下一步, Codex re-review entry condition①要求）。
- **没有生成授权快照文件本身**（`--snapshot` 指向的 JSON 由 Owner/委派人过目定案后生成, 不是 G5 自己造）。

@NWT @KANet-UI 请审（重点：db_path 单一来源无重复解析、身份判定 null 即拒、journal halt-on-corrupt 逻辑、singleton scope enforce 是否有遗漏字段）。过了我接着写测试。
