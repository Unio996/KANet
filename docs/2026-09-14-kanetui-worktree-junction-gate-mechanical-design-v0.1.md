# 跨树 junction 机械闸设计 — 接 check-worktree-junctions.mjs 进 pre-commit + 推送闸 v0.1

**2026-09-14 · KANet-UI · Bettor 1281 派工**（"docs first，J2 审而非 NWT"——机械闸/流程改动，非安全/钱路代码，走 J2 审核线）。**本页只写设计，不落码**——落码需 J2 审 GREEN 后另出。

## 0. 背景

`scripts/check-worktree-junctions.mjs` 已存在（ANTI-PATTERNS 规则 81，2026-08-29）：列出所有 worktree（默认不含主树，`--all` 含）里的 junction/symlink，分三档——`internal`（链的目标在同一棵树内，设计内，如 `node_modules/kaspa-wasm → <本树>/shared/vendor/kaspa-wasm`，不算坏）、`→LIVE`（链的目标在主树，本身不在主树——删这个 worktree 会顺着链删进主树，规则 81 描述的原始事故形状）、`external`（目标是别的第三棵树，同样跨树，只是不是主树）。**`internal` 以外一律 `exit 1`**，`internal`-only 或零链 `exit 0`。**这个脚本本身已经能正确判断，缺的只是"没人在关键动作前调它"**——现在是纯手动、删 worktree 前"必跑"停留在文档约定层面，不是机制。

## 1. 现状实测（本次核实，作为设计的性能依据）

```
node scripts/check-worktree-junctions.mjs         → 1.654s，38 worktree（不含主树），0 坏链
node scripts/check-worktree-junctions.mjs --all   → 1.811s，39 worktree（含主树），0 坏链
```

当前机器上共 **39 个 worktree**（含主树），全部干净（只有设计内的 `node_modules/kaspa-wasm` internal 链）。~1.6-1.8s 对 pre-commit/推送这种低频、高价值动作是可接受的摩擦——不是每秒多次触发的热路径。

## 2. 接入点设计

### 2.1 `.githooks/pre-commit`

现有结构（① lint-kanet block-on-fail，② check-tree-fresh warn-not-block，③ check-tests-fresh warn-not-block）新增第 ④ 项，**block-on-fail**（不用 `|| true`，这条是机制不是提示）：

```sh
# ④ check-worktree-junctions: block-on-fail (2026-09-14, Bettor 1281 派工·规则81机制化)
#   跨树 →LIVE/external 链存在 = 本机 worktree 处于危险状态(删任一侧树都可能连坐主树),
#   不该让这种状态下还能继续往前推进(commit 本身不碰 worktree, 但"危险状态存在却没人管"
#   本身就该在下一个必经关口被拦一次, 而不是只等到真的执行删除那一刻才发现)。
node scripts/check-worktree-junctions.mjs --all
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo ""
  echo "[pre-commit] ✗ 检测到跨树 junction (→LIVE 或 external)·commit 拦截."
  echo "  规则81: 删侧树前先拆链 (cmd: rmdir <link> / PowerShell: [System.IO.Directory]::Delete(link,\$false))"
  echo "  手动重跑: node scripts/check-worktree-junctions.mjs --all"
  exit 1
fi
```

放在 hook 末尾（① lint 之后），因为 lint 失败已经直接 `exit 1`、不会跑到这条——两个 block 点独立即可，不需要合并判断。

### 2.2 `_bettor_push.sh`

在 `git fetch` 之后、真正 `git push` 之前插入同一个检查（用 `--all`，因为推送是比 commit 更高风险的动作——commit 只影响本地，push 让别的会话/机器立刻能拉到，且推送前"确认没有任何 worktree 处于危险态"这件事本身价值更高）：

```bash
# 跨树 junction 闸(2026-09-14 Bettor 1281)：推送前确认没有任何 worktree 处于→LIVE/external 危险态。
if ! node scripts/check-worktree-junctions.mjs --all; then
  echo "⛔ 拒推: 检测到跨树 junction (→LIVE 或 external)，见上方输出。规则81：先拆链再推。"
  exit 6
fi
```

放在 `git fetch -q origin "$BR"` 之后、`H="$(git rev-parse HEAD)"` 之前（不依赖队列长度判断，独立于现有的队列一致性检查逻辑，检查失败直接短路，不消耗后面的队列比对）。`exit 6`——现有脚本已用 `2/3/4/5`，避开冲突，新增一个专属码方便日后从退出码直接反查触发的是哪一层。

## 3. 判据范围：不只 `→LIVE`，`external` 一并拦

Bettor 原话点名"→LIVE"，但脚本自身的坏链判据是 `kind !== 'internal'`（`→LIVE` 和 `external` 一起算坏）。**本设计不做特判、直接吃脚本原生退出码**——理由：`external`（链指向另一棵非主树的 worktree）删起来同样会连坐（只是连坐的不是主树而是别的侧树），机制上跟 `→LIVE` 是同一类风险，只是受害目标不同；脚本已经把两者一起归类为"坏"，机械闸没有理由在两者之间再区分优先级——**都堵，不单独放行 external**。如果 J2 审的时候认为只想卡 `→LIVE`（放行 `external`），需要改脚本本身新增一个 `--live-only` 之类的旗标，本设计目前不建议加这层复杂度（"跨树链只要不是本树内部设计, 一律不该存在"本身是更简单也更安全的规则）。

## 4. 边界情况

- **`git worktree list` 本身失败**（如 `.git` 损坏）：脚本内 `execFileSync` 无 try/catch，会直接抛未捕获异常，Node 进程以非零退出码结束——**天然 fail-closed**，不需要额外处理；本设计不改脚本，只是记录这个既有行为是符合"出错时拦，不是放行"的意图。
- **本机新增/删除 worktree 频率**：39 个 worktree 大多是各 agent 长期持有的侧分支检出，不是每次 commit 都变化——~1.6-1.8s 的开销是"扫当前状态"，不随 commit 频率放大（每次都要重新扫，因为"上次干净"不代表"这次还干净"，工作树集合可能刚变过）。
- **hook 未激活的检出**（新 clone 没跑 `git config core.hooksPath .githooks`）：这条闸和现有 lint-kanet 闸一样，依赖 hook 被激活——不在本设计范围内解决"hook 没装"这个更早层面的问题，同现有 CLAUDE.md 对新 clone 的既有要求。

## 5. 不在本设计范围内的事

- 不改 `check-worktree-junctions.mjs` 脚本本身（已经工作正常，判据已经是需要的判据）。
- 不新增自动拆链能力（发现坏链后仍是"人读日志手动拆"，不做成自动修复——跨树链删除是有风险的操作，不该在一个"检查脚本"里顺手做破坏性动作）。
- 不改动 `check-tree-fresh.mjs`/`check-tests-fresh.mjs` 两条既有 warn-not-block 检查的性质或顺序。

## 6. 验收标准（落码后自测项，供 J2 审时核对）

1. 人为在某侧 worktree 里建一条指向主树的 symlink/junction（`New-Item -ItemType Junction`），确认：`git commit` 被拦、`bash _bettor_push.sh` 被拦，两处报错文案都指向"规则81 + 拆链命令"。
2. 拆掉该链后，两处均恢复放行（回归到当前的 0.654s~1.8s 级别延迟，非阻塞级别）。
3. `.githooks/pre-commit` 里这条新增项在 `lint-kanet` 之后、其余两条 warn-only 检查之前或之后均可（无先后依赖），但必须在末尾 `exit 0` 之前。
4. `_bettor_push.sh` 里这条新增项必须在 `git fetch` 之后（否则扫到的 worktree 状态可能是过期快照）、在真正 `git push` 之前（否则拦截没有意义）。
