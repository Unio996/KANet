# C 分阶段 arm 机制 + app provision 实战 harness — NWT 合审 verdict（开闸前最后审）

> **Status**: NWT 合审 **GREEN**（2026-07-23）· arm 前提①（harness）+ 收敛类处置（C 机制）双闭 = 开闸前技术审全过。
> **审对象**: `f8d5f62b`（C ①④⑤ authorize 第5值+armReport + harness）+ `0ded64f7`（C ②③ 收敛类改标+shrink lint）。
> **判据**（Bettor load-bearing）: ①第5值只显式 legacy 放行·真缺失/非法仍拒 ②armReport LOUD ③shrink baseline 只减不增 ④⑤harness legacy 分支 ⑥app provision harness evidence log 链上/DB 真态（非只报 PASS）。

---

## C 机制①②③④⑤：全 GREEN

- **① authorize 第5值 legacy 分支（安全核心）**：`if (origin === 'legacy-unmigrated')` = **显式正向匹配**放行 + LOUD warn + `_legacyPassCount++`。**真缺失/非法 fall-through 仍 `deny origin缺失/非法`（不变）**——注释明标"新未迁移路由/被剥 origin 攻击/未声明命令都落这里=拒·与 legacy 显式 tag 关键区别"。=不重开 fail-open。✅✅ evidence 实证: legacy→allow / 缺失(undefined)→deny fail-closed / spoofed→deny。
- **② 收敛类改标穷尽**：pool/relay/trading **无一 sendCommandAsync 漏标**（含 3 处多行 call 闭合行 pool:492 refund签名/pool:1627 per_bet/trading:2473 transfer 均标）。零遗漏=armed 不因漏标断收敛类。标值恰好 'legacy-unmigrated' 显式。✅
- **③ R-LEGACY-ORIGIN-SHRINK lint（ERROR·比我设计强）**：三道 ratchet——①文件计数>baseline→拒（新增禁）②**硬 ratchet: baseline 自身只降不升（git HEAD 对比·防抬 baseline 绕门）** ③计数<baseline→warn 提醒收紧。**硬 ratchet 机制化了我设计标的"无硬 ratchet 则纪律依赖"残留**。计数只认代码带引号 legacy（注释剥除）与 gate 消费同源。baseline 缺失+legacy 存在→fail-closed。✅✅
- **④ armReport**：加 `legacyUnmigratedPassCount` + `lastLegacyUnmigratedPassAt` LOUD（防静默永久化·健康探针追踪 shrink 到零 + 滞留告警）。✅
- **⑤ harness legacy 条**：origin 五值谱（internal/operator/legacy 放行·缺失/spoofed 拒）evidence 实证。✅

## app provision 实战 harness（arm 前提①）：22/22 PASS·真态确凿 GREEN

evidence log `logs/test-runs/m0c1-gate-harness-latest.json` 逐命令核（非只信 22/22）：

- **armed 真开**：bootstrap "armed relay 起·模块未 throw" = flag 真 true（否则 arm 前提焊死 throw）。fork 真 relay 子进程走生产 authorizeCommand→verifyAppEnvelope→switch（非 mock/非孤立单测）。
- **sha256 flip round-trip**：orig=b20bf2af → flipped=dd35b2a5 → restored=b20bf2af，clean:true。跑的 flip 那份（dd35b2a5）就是正式 flip 要装的（NWT 核锚）。
- **真 kaspa 签名非 stub**：app-envelope-sdk 用 `kaspa.signMessage(真 PrivateKey)`，复用 relay 侧同一 canonicalJson/envelopeSigningMessage/wasm（签发端==验证端单源·不漂移）。
- **五条 + 攻击族 real behavior**：
  - allow（合法 transfer）= `gateDecision:"allow(进 switch)"` + reason=`RpcClient not ready`（gate 过+执行层失败·非 deny·NO TX 天然守）——正向证 gate-allow（区别于 deny）。
  - 越 scope: 超额度（99>3KAS 上限）/scope 外收款人/未授权命令（inflation）/未授权维度（market_scope NULL 最严）各真 deny 带真 reason。
  - **伪签族（错钥/改 nonce/relay/network/expires/grant_id 各单独）→ 各验拒**：改 nonce→"信封签名验证失败(全 canonical envelope 去 signature)" = **我立身之本签名范围 MUST-FIX 代码级实证**（nonce 在签名字节内）；改 relay/network→双重绑定拒；改 grant_id→grant 不存在拒。
  - **掉包→"intent.amount != cmd.amount (verify-value-source)"** + cmd 多带字段→"字段集不匹配掉包拒" = **verify-value-source MUST-FIX 实证**。
  - **吊销即时**：__REVOKE__ 真跑 operator provision revoke → 下条同 grant→"grant 已吊销(fresh 读即时可见)" = **跨进程 fresh 读吊销即时实证**（组件③provision 一并实战）。
- **不装载**：flag=false 保持 + armed=off + console 不重启 = 零行为变更（本 commit inert）。

## note（非 blocker）

- **N-doc**: authorize.mjs arm 前提焊死注释仍写"(2)批C 迁移收口全 internal 标 origin"——C 后收敛类是 legacy-unmigrated 非 internal，注释措辞略 stale（代码 GATE_ARMED&&!flag→throw 正确·非功能问题）。arm 落码时顺手改注释为"全标 origin 含 legacy-unmigrated"。
- **N-readonly**: get_pubkey/check_utxo_landed 等 READONLY_ALLOWLIST 豁免命令整路由标了 legacy（无害·虚增债计数），迁移时可精简走豁免。

## 判据：GREEN = 开闸前技术审全过

- C 机制①②③④⑤全 GREEN（第5值显式放行·缺失仍拒 evidence 实证 / 收敛类穷尽 / shrink 硬 ratchet / armReport LOUD）。
- app provision harness 22/22 真态（armed 真开 / 真签名 / 五条真发 / 立身之本+verify-value-source+吊销即时代码级实证 / sha256 round-trip / NO TX 守）。
- **arm 前提全 GREEN-ready**：①grant/envelope 非 stub+harness PASS ②批C 收口 ③provision 实 ④收敛类处置=C 机制。
- **开闸（armed=on 不可逆）留 Owner 拍·带 caveat**：armed 保护已迁移 app 面+堵未标注入（缺失拒）；**legacy 面（收敛类 pool/relay/trading）仍存量零鉴权暂放行·迁移债 = baseline N 处·LOUD 追踪 shrink 到零**（硬 ratchet 保证只减不增）；legacy=迁移债 marker 非安全控制。GRANT_ENVELOPE_IMPLEMENTED 置 true = 单独 commit（本合审 GREEN 后）。

**关联**: `docs/2026-07-23-NWT-phased-arm-legacy-unmigrated-design.md`（C 设计）、`docs/2026-07-23-NWT-diff-m0c-1-app-provision-code.md`（app provision GREEN）、`docs/2026-07-23-m0c-1-app-provision-harness-design.md`（harness 方案）、`logs/test-runs/m0c1-gate-harness-latest.json`（evidence）。
