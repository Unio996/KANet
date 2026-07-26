> **Status**: CURRENT

# G5 v2 regression 测试 execFileSync 死锁修复 — pending review diff

## 背景

`git worktree` 方案跑通后（干净 checkout，gate①首次真正放行），暴露 regression 测试自身
架构性死锁：父进程用 `http.createServer()` 起 runtime-identity loopback stub，但用
`execFileSync` 调子进程（真实 G5 CLI）——`execFileSync` 完全同步阻塞父进程整个 event loop
（含 libuv），子进程 fetch 父进程的 stub 端点时父进程没法处理这个 incoming 请求，只能干等到
子进程自己的 8s AbortSignal 超时。之前在脏树里跑没暴露，是因为 gate① 每次都先 abort，根本
没走到会触发死锁的 gate③ 那段代码路径。

已用 10 行最小复现脚本（纯净 http.createServer + execFileSync + fetch，不依赖本仓库任何代码）
独立验证根因，并验证 spawn 版本修复后同一份复现脚本子进程能正常拿到 200：

```
execFileSync 版本: [DOMException [TimeoutError]: The operation was aborted due to timeout]
spawn 版本:         parent: child result: { code: 0, stdout: 'child got 200\n' }
```

这是 regression 测试文件自身的 bug，不是 G5 生产代码 bug，不动 gate 设计。

## 修复内容

`kasia-console/test-framework/cases/m0c1-gate/g5-real-chain-smoke-regression.mjs`：

- `runG5`/`runReconcile` 从 `execFileSync` 同步调用改成新增的 `runChildAsync()`（基于
  `spawn` + Promise，事件驱动收集 stdout/stderr，`close` 事件里 resolve `{code, stdout,
  stderr}`），使父进程 event loop 在子进程运行期间保持响应，能正常服务 loopback HTTP 请求。
- 保留全部三点要求（Bettor 2026-07-25 确认）：①stdout/stderr 全量捕获（`data` 事件累加，
  跟原 execFileSync 版本捕获到的内容等价）②父 stub server 在子进程运行期间真能响应（这正是
  修复的核心）③子进程 exit code 保留（`close` 事件的 `code` 参数，`?? 1` 兜底 null 的
  信号杀死场景）。
- 所有调用点（19 处 `runG5(...)` + 2 处 `runReconcile(...)`）加 `await`，`main()` 本就是
  async，局部改动。
- `execFileSync` 保留给纯本地 git 命令用（HEAD 读取、历史 commit 查找、journal 里的
  `source_commit` 记录）——这几处不涉及子进程回调父进程 HTTP 端点，没有死锁风险，改成 spawn
  没有意义反而增加复杂度。

## 验证

- `node --check` 语法通过。
- 独立 10 行复现脚本证明 execFileSync→死锁 / spawn→正常，见上。
- 完整 regression 套件在真实 worktree 里的验证**待本次 diff 过审+落码后**进行（复制修复后的
  文件进已有干净 worktree `D:/kanet-g5-test-wt` 会让那个 worktree 变脏，反而重新触发 gate①，
  所以完整回归验证放在 commit 之后，用 `git worktree` 重新对齐到新 commit 或新建一个）。

## v2 修订（KANet-UI review 提·Bettor 确认加）

`runChildAsync` 原版没有超时兜底——万一子进程真的挂住不退出（G5 自身各处都有超时: fetch
45s / RPC 连接 8s / 落链轮询 20×3s=60s 封顶，正常不该无限挂，但万一撞到一个没预料到的路径），
Promise 会永远不 resolve，整套 regression 会挂死而非干净 FAIL。加 `CHILD_TIMEOUT_MS =
100_000`（宽于 G5 自身最长内部超时 60s），到点 `child.kill('SIGKILL')` + resolve 成清晰的
"子进程超时"字符串，用 `settled` flag 防重复 resolve（kill 之后 close/error 事件仍可能触发）。

## content_digest

sha256: `f2823e6a720f4b1277261a2a1cb3ba820b81d3836035701d13ff95fbac1e5ab9`（v2，含超时兜底）

M0a manifest 里这个文件是 `TFW-g5-real-chain-smoke-regression` 条目（capability
`m0c1-test-fixture-writer`），当前锚的 digest 是修复前版本，需要在过审后同步更新为上面这个
新 digest + 新 review_ref。
