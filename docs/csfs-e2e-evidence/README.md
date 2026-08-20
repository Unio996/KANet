# checkSigFromStack 链上 E2E — 证据副本

> **Status**: CURRENT

**日期** 2026-08-20 · **作者** J2 · **编译坐标** `versioned-builds/silverc-zk-8065184.exe`
**裁定** A2 runtime = CLOSED（Bettor 12:32，J2/NWT/Bettor 三方各自独立验证收敛）

---

## 为什么在 `docs/` 而不是 `scratch/`

原始产物写在 `scratch/e2e/run-evidence.json`，而它**每轮跑完就被覆写**。
这一天里它咬了两个人各一次：

- **J2**：上一轮 8/8 的拒因原文只活在进程内存 + 被日志截断 ⇒ **永久丢失，无法补测**；
- **NWT**：比对时读到**已被 CLEAN 轮覆写**的那份，误当作 DIRTY 轮，得出错误结论并撤回。

🔨 **可变、会被覆写的产物不能当对照基线。** 比对一律用本目录这两份。

## 文件

| 文件 | 内容 |
|---|---|
| `2026-08-20-csfs-8cell-run-evidence.json` | **DIRTY 轮**（7 PASS / 0 FAIL / 1 不可归因） |
| `2026-08-20-csfs-8cell-CLEAN-run-evidence.json` | **CLEAN 轮**（8 PASS / 0 FAIL / 0 不可归因，exit 0） |
| `2026-08-20-csfs-vectors.json` | 八格测试向量（不含私钥） |

## 判据（**预注册于看到结果之前**）

V0 PASS ∧ V5c PASS ∧ 全部负例因**脚本验证**被拒 ∧ **零 inconclusive**。

「因脚本验证」的判别串 = 拒因原文含 `failed to verify the signature script`；
tx 格式拒 / 节点状态拒 / 拒因读不到 一律不算。**判别串写进 harness 强制，不靠肉眼归类。**

## 结果

CLEAN 轮四条判据全中。6 个负例全部因脚本验证被拒；其中 **V4（全零 sig）内层原因不同**
（`script ran, but verification failed` 而非 NULLFAIL），但外层 wrapper 相同 ⇒ 判别串无假阴。

### 🔴 txid 撞车 —— 准确措辞（曾被误写，此处为订正后版本）

CLEAN 轮有 3 笔 txid 与 DIRTY 轮撞车。**正确说法**：

> 本轮 **15 笔花费交易全部为本轮新构造、新提交、被节点按本轮 witness 新验**。
> 撞车因 **① Kaspa txid 不含 `signatureScript`**（换 witness 不改 txid）
> **② CLEAN 轮复用了 DIRTY 轮遗留的未花 UTXO**，按链上返回序取用致配对整体位移 2 格。
> **id 撞 ≠ 交易同。**

❌ **不可写成**「复用历史被拒 tx、非新构造」——那会被读成"这三格本轮没测"，与数据相反。

**双向判别**（排除「缓存判决」与「陈旧证据」两种可能）：

| 方向 | 检验 | 结果 |
|---|---|---|
| 同 txid `6c1aa057` / 不同向量 | DIRTY V4(全零sig) vs CLEAN V2(翻digest) | **拒因变了** ⇒ 排除缓存与陈旧 |
| 同向量 V4 / 不同 txid | `6c1aa057` vs `6a34068a` | 拒因不变 ⇒ **正证** |
| 同向量 V2 / 不同 txid | `d68c9d91` vs `6c1aa057` | 拒因不变 ⇒ **正证** |

⇒ **拒因是【向量】的函数，不是 txid 的函数。**
🔵 附带证明：**节点不按 txid 返缓存判决，每次真跑脚本按实际 witness 出结果。**

## 🔴 证据强度的真实形状（两半必须分开说）

- **正例**：V5c、V0-final（`b5306eddf7ad…`）及各窗 V0 = **真落链，任何人可独立复核**。
- **负例**：被拒 tx **从不进 DAG** ⇒ **「被拒原因」不可第三方复核**，只能信广播当下捕获的 RPC 原文。
- 🔵 **但「被拒事实」可以跨节点独立验，且不需要 txindex**：
  拉 P2SH `kaspatest:pq646mlq82wt79kqkdhcpme2wwa072uwxdu6ectwk5qqa6r8hlpjzpys2te5s`
  的未花 UTXO 集合 —— **PASS 格花掉的那笔应已消失，REJECT 格的应仍在**。
  J2 实测 **15/15 全中**（脚本 `scratch/_predict.mjs`，只读）。

⇒ 精确表述：**负例的【被拒事实】可跨节点独立验；负例的【被拒原因】不可。**

## 边界

本卡只证**这一个原语的 codegen 在链上行为正确**，**不等于 §6-3 A2 整体可用**
（attestation 绑定、层间依赖不在本卡）。
