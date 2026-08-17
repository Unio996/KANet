# artifact#3 · 执行方外域 attestation（**正式** · run 前产出）

> **Status**: CURRENT

**这份是 artifact#3 bundle 的第二部分**（三部分并列：仪器 JSONL / **本 attestation = 权威外闭** / J1 复核）。
预草与设计理由见 `2026-08-17-j2-artifact3-executor-attestation.md`；本文件是**跑前实测的那一份**。

## 一、比对（**run 开始之前**产出）

```json
{
  "attestation": "artifact3-executor-launcher-blob",
  "executor": "J2 / J2-tn",
  "executor_relay_id": "102cbb99-9115-4504-8928-5c22359f1852",
  "hashed_at": "2026-08-17T19:14:58Z",
  "target_path": "scripts/j1-trough-probe-launch.sh",
  "method": "git hash-object <path>  (在隔离 worktree 内, 不经 launcher 自报)",
  "executor_computed_blob": "23ec24ec7ee09068a1a28fc4de5cb4c49cb993be",
  "codex_accept_recorded_blob": "23ec24ec7ee09068a1a28fc4de5cb4c49cb993be",
  "match": "MATCH",
  "approved_commit": "06b3bb55b7380c5fb6e48d9acab39be9aff68d08",
  "head_equals_approved_exactly": true,
  "tracked_clean": true
}
```

🔴 **`codex_accept_recorded_blob` 这次填的是 Codex RE-ACCEPT（桥 `4a31158d`）记录的值**，
不是我们自己的 ledger 转述 —— 这正是预草文件第二节完成条件第 1 条要求的（比对两半不得同源）。

## 二、🔴 披露：本 run 跑在**隔离 worktree**，不是主树

| 项 | 值 |
|---|---|
| worktree 路径 | `/d/kanet-tn12/scratch/probe-wt`（gitignored） |
| HEAD | `06b3bb55…`，**精确等于批准 commit，不是 branch tip** |
| tracked 改动 | 无（`git status --porcelain` 去掉 `??` 后为空） |

**为什么不在主树**（协调者 (472) 裁定、全员收敛）：主树是 **live 共享树** ——
console 与全部 relay 正从它运行，另两名 agent 同树作业；
而本 run 的时长 = 仪器拿满 3 个样本（每次间隔 ≥15 min），**不可控**。
在主树 checkout 旧 commit 会造成一个**长度不可控的共享冻结窗**。

⚠ **Codex 明确钉死的易错点，我照做了**：checkout 的是 **`06b3bb55` 本身**，
**不是 branch tip**（现 tip 更新、两个脚本恰好字节相同，但 Codex 明说"跑 later tip 观察脚本一样 ≠ 等价"）。

## 三、依赖供给：**拷贝，零链接**

仪器唯一外部依赖 `kaspa-wasm` 经 `kasia-console/package.json` 的 `file:../shared/vendor/kaspa-wasm` 解析。
`shared/vendor/kaspa-wasm/` **本身是 git-tracked**，所以 worktree 检出时**自带**。

我在 worktree 内部把它**拷贝**到 `kasia-console/node_modules/kaspa-wasm`：

- ✅ **拷贝而非符号链接** —— 实测**整个 worktree 里符号链接数 = 0**；
  🔴 理由是我自己的事故：上一版 harness 用 junction 挂主树 `node_modules`，
  收尾的 `git worktree remove --force` **顺着链接删穿**，清空了主树那份真依赖。**零链接 = 结构上删不穿。**
- ✅ 拷的是 **worktree 自己那份**（同一 approved commit 的字节），**零引用主树**；
- ✅ 运行时 pin 实测对上：
  `require.resolve('kaspa-wasm')` ⇒ `…/scratch/probe-wt/kasia-console/node_modules/kaspa-wasm/kaspa.js`
  entry sha256 `07f86beb…` == `PINNED_RPC_ENTRY_SHA` ✅
  wasm  sha256 `51cec45e…` == `PINNED_RPC_WASM_SHA` ✅

## 四、🟡 本 attestation **不能**证明什么（与预草同，重申以免被读大）

- ❌ 不证明"运行中的进程真的加载了这份文件" —— 它证明的是**该路径在该时刻的字节**；
  这一格由 **canonical-path-only 规程**补，那是**规程**不是机制。
- ❌ **不是跨主机的外域**：仍在同一台主机上由我计算。
  **"外域"在这里的准确含义是"不由被验对象自己产出"，不是"不在同一台机器"。**
- ❌ 不覆盖 m4 残洞（删掉自绑块 + 换发送地址）。Codex 已按"固有 + 双缓解"接受；
  本 attestation 与之**互补**：它让"launcher 字节被换"**可被外部发现**，
  而**发现的前提是有人真的去比对** —— 所以上面那个 MATCH 是它唯一的牙。

## 五、run 参数

- `J1_PROBE_APPROVED_COMMIT=06b3bb55` · `J1_PROBE_RELAY_ID=102cbb99-…`
- `TIME_CAP=120`（min，硬顶 360 之内）
- 触发语义由**仪器自己**判定：`rate < 1/s` 且距上次探针 ≥15 min；需 **3 个样本**。
- JSONL 落 worktree 内 `scratch/j1-trough-probe-artifact3.jsonl`。
