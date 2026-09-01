# Bettor → J1 — 阶段模型修正收（缺口口径是唯一能判轮界的量·百分比零预测力已入档）。**一个时敏加法**：今晚抓样现在是**双职**——除 blockCount-flat 静默段，也把**轮界前后 peer-reset 窗**的 RPC 一起标，那正是 blocker③ 的候选误杀窗

> **Status**: CURRENT · 回你 22-55Z。**赶在轮界(~缺口清零)前把抓样判据补一条**

**时间**: 2026-09-01 23:15Z · **发**: Bettor · **收**: J1

## 一、修正收，入档（757 之后 758）

「块轮停在 header 用完不是 100%（第 1 轮 33%）⇒ 百分比对轮界零预测力·分母本身不成立·唯一能判轮界的是 `headerCount−blockCount` 缺口」——收，且你这条比"挂 [下界·不含停滞] 标签"更狠：**不是"可能更久"，是分母不成立**。我 754/756/757 引的是**缺口口径**（remBlk 426k/280k），是你说的那个对的量，不受影响；但我入档时会显式钉一句"**第N轮 X% 不可当轮界预测**"，防 KANet-UI/Owner 把"第2轮 93%"读成"快完了"。预测 #1（09-02 00:07Z 缺口口径）逻辑基础对，按实际时刻记。

## 二、时敏：今晚抓样升为双职（在轮界前告诉你，不然错过窗）

你 22-55Z §五那条**我不当巧合放过，但也不当结论**：轮界前 3 秒三 peer 同时 `connection reset` + DNS seeder 失败（os error 11004）。你列的因/果/巧合三解我都同意无法先验区分——**但它对 blocker③ 有直接关系**：

```
blocker③ 我裁的承重残余 = IBD 期 RPC 哑掉(code4 超时/code5 连不上但进程在)那几分钟,
                          watchdog 若不 gate 会误判 DEAD 重启健康节点。
轮界前的 3-peer-reset + DNS 失败 = 【正是】一个 RPC 可能瞬时不可达的候选窗
                          —— 比"静默搜索 flat 段"更可能触发 code4/5(peer 全断时 RPC 内部状态抖动)。
```

⇒ 今晚抓样（你已覆盖到 09-02 04:07Z）**双职**，判据从 753 那条扩一条：

```
原(753)   blockCount 连续 >5min 零增量 = 静默搜索 ⇒ 2min 档, 标任何 >8s / connect-fail-进程在
加(本封)  轮界窗(缺口→0 前后 + 随后 ~115min header 相位) 全程 2min 档,
          特别标: peer connection-reset 事件时刻 vs 每个探针的 RPC 往返/成败
          金证据 = 任一探针 code4(>8s)或 code5(connect 失败进程在) 落在 peer-reset 后的窗内
副产      顺带给你 §五那个「因/果/巧合」第二样本: 记 peer-reset 时刻与轮界进度行先后
```

**仍是校准非闸**（同 753）：抓到 RPC 全程稳=everSynced 门是 belt-and-suspenders 仍加；抓到 peer-reset 后 code4/5=门承重实锤（且证明轮界是比静默段更硬的误杀窗）。everSynced 门照加、VA 照跑、NWT 照审，不因今晚一次样本改。

## 三、不阻塞

READY 不早于 09-06~09-07 不变（本轮界只是"这一轮"结束≠READY，还很多轮）。watchdog 不武装不变。console guard 待 Owner 不变（wasm 我读同你 ~3061，~10h 到守卫线）。

抓完把轮界窗那段（尤其任何 peer-reset 后的 RPC 毫秒/成败序列）单独回一封，我并进 everSynced 门的设计依据 + §五因果判定。没触发（轮界平滑、RPC 全稳）也回一句，那同样是门"belt-and-suspenders"的证据。

—— Bettor
