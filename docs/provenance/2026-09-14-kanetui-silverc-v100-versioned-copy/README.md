# silverc v1.0.0 版本化复制执行证据（2026-09-14 · KANet-UI · Bettor 1218 派工 · D-019 锚点确认后执行）

> 执行依据：方案页 `docs/2026-09-14-kanetui-silverc-v100-versioned-copy-plan-v0.1.md`（commit `0e571aad`，已推），NWT 复核后 Bettor 1218 确认锚点（D-019）并给 GO。本页记录实际执行的四步（复制+校验/MANIFEST/env/本页），均为本人直接执行+核对，非转述。

## 时间

`date -u` 实取：`2026-09-14T02:40:34Z`（执行动作发生在此前后，各步命令输出见下）。

## ① 复制 + 前后 sha256 校验

| 项 | 值 |
|---|---|
| 源文件 | `D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe` |
| 源 commit | `3ed973335b59269293564805cc2c58a14595ec03`（"Prepare SilverScript 1.0 and clarify ABI artifact validation (#248)"，2026-09-09 19:47:25 +0300），tag `v1.0.0` |
| 复制前该隔离克隆状态 | `git status --short` 只有未跟踪的 `build.log`，源码干净；`git log -1` 再次核实 HEAD 未变 |
| 复制前 sha256 | `4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643`（`sha256sum target/release/silverc.exe`） |
| 复制命令 | `Copy-Item -Path "D:\kanet-tn12\scratch\_j2_silverc_v100\target\release\silverc.exe" -Destination "D:\silverscript\versioned-builds\silverc-v100-3ed9733.exe"` |
| 目标文件 | `D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe` |
| 复制后 sha256 | `4378BA6557F7B7B088D6AD7A400422ACB51A7FFD04F86ED974055C4177EF8643`（`Get-FileHash -Algorithm SHA256`，大小写差异不影响比对，逐位一致） |
| 文件大小（复制前/后） | `6998016` / `6998016` bytes，一致 |
| **结论** | 复制前后 sha256 **逐字一致**，且与 Bettor 1216/1218 原话给出的哈希 **逐字一致**（三方互证：源文件实测、复制后实测、Bettor 转述值）。NWT 提到的 `2ca22dc5...`（带诊断行的另一份构建）不是本次的源，未被使用，已在 MANIFEST.txt 条目里注明避免混淆。 |

## ② `D:/silverscript/versioned-builds/MANIFEST.txt` 补第三条目

新增条目 `silverc-v100-3ed9733.exe`（照抄既有两条目的格式：commit/来源/SHA256/用途/验证/注意事项五段）。用途栏照 Bettor 1218 原话写"待 T4/创世路径接线，D-019 锚点"，并明确写"当前尚未接线到任何调用点"，不虚构验证结果——功能性 byte-exact 验证留待锚点（具体调用点）确定后另做。该文件本身不在 `kanet-tn12` git 仓库范围内（`D:/silverscript` 是独立本地目录），改动前后没有 git 版本历史保护，本页留存改动前后的关键信息作为唯一可核对记录。

## ③ `kanet.mainnet.env` 新增一行

```
SILVERC_V100_PATH=D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe
```
写在既有 NWT 2-1 热钱包准入门那节之后，独立一节，带来源/用途注释。**未重启 console**——写入前后核实 `logs/mainnet/console-mainnet.pid` 均为 `15396`，PID 未变，符合 Bettor 1218 "生效随 pin 修补部署一并做，不重启" 的要求。本人已 `grep -rn SILVERC_V100_PATH kasia-console/src` 全仓核实零消费点——这一行目前不改变任何运行时行为，纯提前声明。

## ④ 本页（provenance 记录）

即本文件。

## 后续（不在本次范围内，供追踪）

- 这个二进制何时被实际接线到某个调用点（"锚点"落地）、届时的功能性验证（byte-exact 对照、NWT 独立复现）——另派另记。
- pin 修补部署本身——另派另记，`docs/2026-09-14-kanetui-mainnet-closezkv2-genesis-autotrigger-audit-v0.1.md` 已确认在此之前主网 console 无自动触发面，本次操作不改变那份结论（仅提前声明了一个尚未被任何代码读取的 env 路径）。
