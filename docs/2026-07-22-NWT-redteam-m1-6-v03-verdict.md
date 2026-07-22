# M-1.6 v0.3 决策稿 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-22 · NWT）
> **审对象**：`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md` v0.3（J2，commit `1bf6defb`）
> **立场**：红队默认 refute。这稿是被 Codex B-0 推翻后的修订 + 我两条红队硬牙的落地，我尤其查它有没有**在"诚实分场景"外壳下重新偷偷 overclaim**。
> **verdict**：**GREEN**（无 MUST-FIX）+ 2 条非阻塞完整性 note。v0.3 忠实落地走乙路的诚实义务：B-0 置顶、6 条 Codex MUST-FIX 全归属带走乙残留诚实注记、我两条硬牙（grant-inflation 独立缺口 / authority-outside-Console 边界）都到位、禁用词表 §1.3 全稿自洽、负向测试按 R-未收口如实标 LANDS 不假装拦住。

---

## 试过的攻击（挣 GREEN 的过程，逐条打不穿）

1. **grant-inflation 在乙路下是否自相矛盾**（我点 A × §4.1 authority-in-Console）：查——§8.3 scope-inflation 判"必须 BUST"是否与"grant 权威在 Console 域"冲突？**不冲突**：场景 A = 应用被攻陷、Console 未攻陷；Console 签发的 grant 应用伪造不了，故应用被绑死在其 grant 内、scope 膨胀 BUST。§8.3 明确 scoped 到"场景 A 攻击"，正确。打不穿。
2. **overclaim 扫描**（全稿）：§3 A/C 职责全部显式 scoped 到场景 A/C + 明写"对场景 B 零防御/无效"；§8 测试逐条标"设计期 LANDS（R 未收口）"；§1.3 禁用词表在 §3/§4/§7 全程遵守，没找到一处把 M0c/A+C 暗示成抗 Console。打不穿。
3. **authority-outside-Console 有没有被稀释**（我点 B）：§4.1 诚实注记明写 MF3/MF4/MF5 信任根走乙期在 Console 域内 = 对场景 A 有效对场景 B 无效，且**加了 diff 审 enforcement**"M0c 实现批须逐条核这三个信任根的宿主，禁把'信任根在 Console 内'描述成'抗 Console'"——比我提的更进一步。打不穿。
4. **6 条 Codex 发现是否漏映射**：B-0→§2 / grant-inflation→MF3 / trust-root-replacement→§1.2(3)+§8.1 / restart-replay→MF4+§8.2 / audit-erasure→MF5+§1.2(5) / multi-user-subject→MF6+§7+§8.4，六条全覆盖且各有负向测试。打不穿。
5. **MF1"v0.3 即闭"是否偷懒**：MF1 = 定义信任边界（二选一）；v0.3 显式选"声明 Console=TCB"并落成 §1 可测基线 = 定义义务已尽，残留由 R 卡承接。闭得正当，非糊弄。打不穿。
6. **containment MF6 会不会借乙路 overclaim**：§7 反而主动收——明写"走乙期 relay 验证本身在 TCB 内，故 containment 卡完整闭合同样 gating 于 R"，只能降爆炸半径 + 诚实声明"tg-bot 被攻陷=授权所有托管用户"，不声称完整端用户授权。与我 containment 二审并轨且不越claim。打不穿。

## GREEN 结论

v0.3 = 走乙路的诚实决策稿，红队席该守的三样（TCB 声明可测、每条 MUST-FIX 防到哪层诚实标、R 收口时点硬约束）全在，且 §1.4 给了"R 收口 = §1.1 TCB 成员逐条移出 + §1.2 五后果逐条 LANDS→BUST"的可测验收基线——这是走乙**不烂尾**的关键：残留被钉成有验收清单的欠账，不是模糊的"以后会做"。可进 Codex 再审。

## 2 条非阻塞完整性 note（不拦 GREEN，供 v0.3.1 或 Codex 再审顺带收）

- **note-1（§8.6 gateway-bypass 的 M0c 前置没标明）**：§8.6 判"独立应用进程绕过尝试 → 应被 A 网关+C 信封拦（场景 A 必须 BUST）"——但这个 BUST 前提是 **M0c 已 armed**（C 信封校验+grant 检查已实现）。当前乙-first 阶段 A+C 仅设计未落码，且红队硬门规定"M0c GREEN+R 收口前应用不得抽离为独立进程"，故 §8.6 的场景-A-BUST 是 **post-M0c 验收断言**，非当前态。建议 §8.6 补一句"(M0c armed 后)"，与其余测试的"设计期 LANDS"标注对称，避免读成"现在就 BUST"。
- **note-2（§1.1 TCB 清单是"全量失守"口径，可补一句更窄的 per-relay 面）**：§1.1 列的是"被攻陷 = relay **全量**私钥失守"的成员（Console/密钥持有者/OS 主体/可写 RELAY_DIR）。另有一个更窄的 TCB：**每个 relay 子进程对它自己那一把 key 也在 TCB 内**（key 在其 env，:83-84）——但单个 relay 子进程被攻陷 = 仅该 relay 单把 key，爆炸半径远小于 Console。不影响乙决策（Console 全量失守是支配威胁），但补一句"per-relay 子进程 = 其单把 key 的 TCB"会让 §1.1 的信任边界枚举更完备。纯完整性，非缺口。

---

**关联**：`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md` v0.3（审对象）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（B-0/三场景）、Codex RED `06d759df`、`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`（MF6 并轨）。
