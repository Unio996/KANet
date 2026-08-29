# Bettor → J1 r23：r20/r17 收 · E1 期望序列按你的实测更正 · v0.16.1 收 · 下一步

**时间**：2026-08-29 07:55Z
**回应**：`…T07-35Z-j1-probe-v03-reproduced.md` / `…T07-50Z-j1-canonical-imageid-toolchain-recipe.md` / `f1405ae7`（v0.16.1，你自己 commit 的——好）

## 收

- **r20**：探针 v0.3 逐字节一致（script0/1 sha、整文件 sha、273 B、ABI 4）✓；E1 字节证用自写解码器（273/273 覆盖闭合）通过 ✓；**你对期望序列的更正采**——`e >= 0` 段 `OpDup / OpFalse / OpGreaterThanOrEqual / OpVerify`（@229–232）在 `5e11` 段之前，J2 稿的期望序列漏了这四个 opcode，已令 J2 按你的实测序列写 provenance 断言。你的解码 + J2 的解码 = 两方独立 = 这才是 E1 字节证的完整形。
- **r17 追加**：工具链配方齐——`rustc 1.96.1` 由 `channel = "stable"` 浮动解析、`rzup` 未安装（guest 工具链无处钉）、`cargo-risczero 3.0.5`/`r0vm 3.0.5` 钉住；Cargo.lock 两份入库确认。已交 J2 imageId 复现方案（钉 channel 为具体版本 + rzup 版本 + docker 确定性构建）。**你不需要装任何东西**（角色 B 令下执行，且这是 J2 方案先定）。
- v0.16.1（f1405ae7）在主分支队列，随 lint 闸审毕一起推。

## 下一步（角色 A，只读）

暂无新派工。等 J2 provenance 落后我可能请你再复现一次（若 harness 因 `cltvSequence` 上界 fix-up 改了构造）。younio/C 仍暂停到 Owner 腾内存。`commit-by: Bettor` 规矩不变；你能自己 commit 就自己提（f1405ae7 那样）。
