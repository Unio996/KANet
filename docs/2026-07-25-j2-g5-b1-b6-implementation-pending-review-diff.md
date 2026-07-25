> **Status**: CURRENT

# G5 v2 B1-B6 落码 — pending review diff

回应 `docs/2026-07-25-j2-g5-b1-b6-hardening-design.md`（team 已收敛的设计稿）的实现。B1/B2/B4/B5
全部落码完成，B6（evidence bundle 生成脚本）落码完成待首次正式调用。B3 按设计仍 deferred。

## 改动文件清单（8 个）

- `kasia-console/src/api/health.js`（改）：B1 端点服务端 loopback+admin-tier 鉴权（IP allowlist
  同时核 `request.ip` + `request.socket.remoteAddress` 两层，专属 tier
  `ADMIN_SECRET_RUNTIME_IDENTITY`）；B2 启动时（路由注册前）计算 load-bearing digest 并入
  `RUNTIME_IDENTITY.load_bearing_digest`（treeDigest/fileCount/dirty）。
- `kasia-console/src/lib/load-bearing-digest.mjs`（新）：`computeLoadBearingDigest(rootDir,
  scopeDirs)` 共享实现，逐文件 sha256 + 排序后的 tree digest。
- `kasia-console/src/lib/runtime-scope-dirs.mjs`（新）：`RUNTIME_SCOPE_DIRS` 共享真值源，G5 和
  health.js 都从这里 import。抽取时顺手修了一个真 bug：原来是裸 `'package.json'`/
  `'package-lock.json'`（相对仓库根），但这两个文件只存在于 `kasia-console/` 下（`git log
  --all -- package.json` 核实过仓库根从未有过这个文件）——git diff 对不存在路径静默返回空，
  这个 scope 条目此前一直是静默 no-op，从没真的检测过依赖声明变动。
- `kasia-console/scripts/m0c1-g5-journal-reconcile.mjs`（改）：B4 `findJournalFile()`/
  `writeJournalAtomic()` 支持按 id 定位+完成 tmp 孤儿的迟到 rename；`list`/`resolve` 同步更新。
  B5 `resolve` 加 `--evidence-file`(digest 入档) + `--approver-1/--approver-2`(白名单
  `ALLOWED_APPROVER_NAMES`，not-spent 强制两个不同姓名，spent 单人但仍须白名单内)。
- `kasia-console/scripts/m0c1-g5-generate-evidence-bundle.mjs`（新）：B6，读 git+显式文件清单+
  regression log，生成不可变 evidence JSON，不碰 DB/money-path。
- `kasia-console/test-framework/cases/m0c1-gate/g5-pilot-custodial-real-chain-smoke.mjs`（改）：
  B1 `verifyRuntimeIdentity()` fetch 带 `x-kanet-admin-secret` header；B2 gate③改成逐字节比对
  `load_bearing_digest.treeDigest` vs `snap.expected_load_bearing_tree_digest`（dirty=true /
  digest 缺失 / 二者不等 都直接 fail，git diff 降级为比对失败时的排障辅助输出，不再是判定
  权威）；B4 `journalWriteAtomic` 加文件级 `fsyncSync`（真实 durability 来源，已实测在这台
  Windows 生产机上有效）+ 目录 fsync best-effort try/catch（Windows/NTFS 上 100% EPERM，已
  实测坐实，非设计依赖的保护层）；`sumSpentKasAndFindAmbiguous` 扩大扫描范围同时读 `.tmp-*`
  孤儿文件，当 prepared 等价状态纳入 `ambiguous`（真正的 crash-durability 保证来源）。
- `kasia-console/test-framework/cases/m0c1-gate/g5-real-chain-smoke-regression.mjs`（改）：新增
  B4 tmp 孤儿场景（4 条断言）、B5 evidence-file/approver 白名单负测试（8 条）、B2 digest
  不匹配/dirty/缺失/snapshot 未声明 四条负测试 + commit-不同-digest-相同应该 PASS 的正测试。
  fixture 侧 `goodIdentity`/`writeSnapshot` 都从真实 `computeLoadBearingDigest(ROOT,
  RUNTIME_SCOPE_DIRS)` 取值，不是造假值。
- `kasia-console/test-framework/cases/m0c1-gate/runtime-identity-endpoint-regression.mjs`
  （新）：B1+B2 端点集成 regression，真 `fastify.listen()` + 真 `fetch()`（非 `inject()`
  模拟——`socket.remoteAddress` 校验需要真实网络层的值），8/8 断言通过。

## 落码过程中撞出并修复的真 bug（团队/自测发现，非提前设计好的）

1. **`unlinkSync` 漏导入**（自测发现）：`writeJournalAtomic` 里 tmp 孤儿清理调用了未导入的
   `unlinkSync`，`try{}catch{}` 静默吞掉了 `ReferenceError`，导致 resolve 后旧 tmp 文件永远
   留着。已修（导入 + 把失败从静默 catch 改成打印警告，不再无声吞错误）。
2. **`process.exit()` 跟 `fastify.close()` 异步收尾撞车**（自测发现，真 TCP 测试才暴露）：
   `runtime-identity-endpoint-regression.mjs` 原版用 `process.exit()`，在 Windows 上跟
   `fastify.close()` 还没走完的 libuv handle 撞车，炸出
   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，把退出码从 0 搅成 127。改用
   `process.exitCode`（只设标记不强制打断，让事件循环自然排空）修复，复测 exit=0 干净。
3. **B1 端点 IP 校验的机制性弱点**（NWT review 发现）：仅查 `request.ip` 不是 TCP 层意义上的
   "server-enforced loopback"（`trustProxy:'127.0.0.1'` 配置下可能是 XFF 推导值）。team 定案：
   新端点（`runtime-identity`，零向后兼容负担）加 `request.socket.remoteAddress` 双核；两个
   既有同族端点（`operator-settle.js:44`/`tg-wallet diagnose:117`）本轮不动，列带触发条件的
   待办（`HOST` 被设非 loopback 或架起反代）。
4. **B4 原设计假设"Windows 是开发机限制、真实部署是 Linux"被证伪**（KANet-UI 实测发现）：
   TN12 生产环境就是这台 Windows 机器本身。团队实测（NWT+J2 独立复现）目录 fsync 在
   Windows/NTFS 上 100% 抛 `EPERM`。最终设计改为：只依赖文件级 fsync（实测真实有效）+ 让
   `sumSpentKasAndFindAmbiguous` 扫描 tmp 孤儿文件当 prepared 等价状态处理，durability 保证
   不依赖那个在这个平台上不存在的目录 fsync。

## 已知局限如实标注

- B2 `expected_load_bearing_tree_digest` 的 snapshot 生成端流程 deferred 到 re-activation
  时机（跟既有"snapshot 由 Owner/委派人在 re-activation 时造"口径一致），本轮只落 G5 消费端
  比对逻辑。
- B5 approver 姓名字段是白名单内的自由声明字段，不是密码学意义上的双人授权（无签名）——如实
  标注为"本地单机 CLI 工具能做到的最大化审计留痕"，不包装成比实际更强的机制。
- `runtime-identity-endpoint-regression.mjs` 测不到"`socket.remoteAddress` 来自一个真的非
  loopback 网卡"这种场景（本机没有第二块网卡可以真实构造），留作 B3 live-process 独立证据
  类别。

## 验证状态

- `node --check` 全部 8 个文件语法通过。
- `node scripts/lint-kanet.mjs` 8 个文件 0 errors（既有 warn-rule 命中跟本轮改动无关）。
- 隔离 worktree（`D:/kanet-g5-test-wt`，真实 `npm install` 补齐依赖，未碰共享/live 树）里独立
  验证：B1 端点鉴权用 `fastify.inject()` 探针 6/6 过，后续升级成真 TCP `runtime-identity-
  endpoint-regression.mjs` 8/8 过；B5 双人复核全套 9/9 过；B4 tmp 孤儿处理新增 4 条断言 3/4
  过（剩 1 条是已知的 gate①-脏树 chicken-and-egg 结构性限制，非真 bug，跟本仓库其余
  regression test 同款假设）。
- B2 的 gate③ digest 比对逻辑因同样的 gate①-脏树限制暂未端到端跑通（需要真实 commit 才能让
  gate① 放行），已对 5 条新测试场景逐条手工 trace 代码路径确认逻辑正确（见 commit message），
  真实端到端验证待本次 diff 落码到干净 commit 之后、走一遍 worktree 全绿时进行——跟 B5 之前
  的验证顺序完全一致（先 review→commit→worktree 全绿）。
- B6 脚本手工冒烟跑通（在当前脏树上跑，`working_tree_dirty_at_generation: true` 如实反映，
  digest 全部正确算出），正式调用待本次 diff 落码+regression 全绿之后。

## content_digest（当前工作树，供 review 时核对）

日期: 2026-07-25。sha256 值见 review 时由 NWT/KANet-UI 独立 `git hash-object`/`sha256sum`
核对，本文档不预先声明（避免"我报的值"和"独立核的值"混淆——按本轮建立的惯例，由审阅方自己
算出 review_ref/content_digest 再回填 manifest，不是我说了算）。
