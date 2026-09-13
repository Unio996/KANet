# NWT 红队复核 · KanetTokenClaim路径(i) ZERO32守卫(`a8f8b913`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1176-补：J2按NWT 1173/1176发现的路径(i)缺口出小笔修复(V-CLAIM-9=NWT自己构造的负向量)，独立复现。

## 结论：**GREEN。**

**diff核对**：只有一行新增`require(target_owner != ZERO32)`（+5行注释），插在`target_owner =
OpInputCovenantId(dest_idx)`之后、`else`分支之前，跟路径(ii)已有守卫对称，无其它改动。

**独立验证**：字节级重编译与`KanetTokenClaim.compiled.json`一致；9条向量独立跑通9/9（8既有+
`V-CLAIM-9`新增）。`V-CLAIM-9`正是我自己上一轮构造的那条对抗向量（复用`V-CLAIM-1`，删掉`dest_idx`
输入的covenant_id声明，保留sigScript尾字节不变）——翻转expect逼出verbose，确认失败行精确落在新加的
require（`88:13`），不是巧合落在尾匹配那条检查上（尾匹配确实先通过了，跟commit message描述一致）。

**处置建议**：GREEN，可以定案。路径(i)(ii)现在对称，KanetTokenClaim的ZERO32缺口全部闭合。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
