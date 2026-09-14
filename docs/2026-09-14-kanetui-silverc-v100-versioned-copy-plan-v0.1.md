# silverc v1.0.0 版本化复制方案 v0.1（2026-09-14 · KANet-UI · Bettor 1216 派工 · 只写方案不执行）

> **Status: DRAFT**。权威：Bettor 1216 派工。**本页只写方案，不执行任何复制/写 env/改 MANIFEST 动作**——执行门：本页 → NWT 确认锚点 → 执行。"锚点"指：这份 `SILVERC_V100_PATH` 未来会不会/什么时候被某个具体调用点读取并接线到实际编译动作——本次只做"把二进制版本化留档+声明一个尚未被任何代码消费的 env 变量"，不改变任何现有运行时行为，NWT 需要先确认这个提前声明本身没有问题、以及后续锚点方向，才能执行。

## 0. 已独立核实的坐标（本人直接读文件/跑 git/算 hash，不是转述 Bettor 原话）

| 项 | 值 | 核实方式 |
|---|---|---|
| 源二进制 | `D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe` | `ls`/`find` 确认存在 |
| 源 commit | `3ed973335b59269293564805cc2c58a14595ec03`（"Prepare SilverScript 1.0 and clarify ABI artifact validation (#248)"，2026-09-09 19:47:25 +0300） | `git log -1` 在该隔离克隆里核实 |
| 源 tag | `v1.0.0` | `git describe --tags` / `git tag --points-at HEAD` 两个命令一致核实 |
| 源二进制 SHA256 | `4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643` | `sha256sum target/release/silverc.exe` 本人实跑，**与 Bettor 1216 原话逐字一致**（互证，不是单一来源） |
| 该隔离克隆状态 | 干净（`git status --short` 只有一个未跟踪的 `build.log`，不是源码改动） | `git status --short` 核实 |
| 该隔离克隆的 `origin` | `D:/silverscript`（本地路径，不是外部 fork） | `git remote -v` 核实——这份隔离克隆本身就是从目标 `D:/silverscript` 克隆出来的，来源链条闭合 |
| 目标目录 | `D:/silverscript/versioned-builds/`（**已存在**，不需要新建） | `Test-Path` 核实 `True` |
| 目标文件 `silverc-v100-3ed9733.exe` | **目前不存在**——本方案尚未执行的直接证据 | `ls` 核实无此文件 |
| `D:/silverscript` 当前 HEAD | `80651849...`（"Fix OP_PICK off-by-one in compile_byte_sequence_cast_call"）——**不是** `3ed9733`，是 CLAUDE.md 铁律 0.5 提到的那个本地未推 OP_PICK 修复分支 | `git log -1` 核实——说明源二进制来自一次**独立隔离克隆+编译**（`_j2_silverc_v100`），不是从 `D:/silverscript` 当前工作树直接编的，两者是两回事，不会互相覆盖 |

## 1. 为什么"复制到独立版本化文件名"而不是原地用——已有真实事故先例

`D:/silverscript/versioned-builds/MANIFEST.txt`（2026-07-07，J2 已写）记录了一次真实生产事故：`D:/silverscript/target/release/silverc.exe` 曾经是 `kasia-console` 默认编译路径的**原地**产物，一次针对另一分支的原地 `cargo build` 重编译覆盖掉了能正确编译 `ShardLeaf.sil` 的旧二进制，导致 bshard 押注全线中断（23:41-00:47）。修复措施是"按合约族分离、版本化独立文件名存放、禁止向 kasia-console 依赖的任何默认路径原地覆盖"——**本方案沿用这条已经用真实事故换来的纪律，不是本页新提议**。这也是为什么源头选的是隔离克隆 `_j2_silverc_v100`（已独立编译好、跟 `D:/silverscript` 工作树的分支切换互不干扰）而不是直接指向 `D:/silverscript/target/release/silverc.exe`（那个路径会随 `D:/silverscript` 工作树切分支/重编译而变化，不适合作为长期引用的坐标）。

## 2. 计划步骤（执行时按序，本页不执行）

1. **复制前 sha256**：对源文件 `D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe` 算一次 sha256，记录（应得到 `4378ba65...`，见 §0）。
2. **复制**：`Copy-Item` 到 `D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe`（新文件名，不覆盖任何既有文件——`silverc-legacy-2c46231.exe`/`silverc-zk-8065184.exe` 两个既有文件不受影响）。
3. **复制后 sha256**：对新落地的文件再算一次 sha256，与步骤 1 逐字比对，必须完全一致才算复制成功（标准完整性核验，不是走过场）。
4. **更新 `D:/silverscript/versioned-builds/MANIFEST.txt`**——🔴 **这条 Bettor 1216 原话没有点名，是本页按已有约定推出来的，不是自作主张替 Bettor 扩大范围，在这里明确列出等 Bettor/NWT 确认要不要一并做**：MANIFEST.txt 现有两个条目（`silverc-legacy-2c46231.exe`/`silverc-zk-8065184.exe`）各自记了 commit/SHA256/用途/验证状态，本文件开头写明"防御性记录，供 Phase1 fresh 会话快速核对 hash 一致，不依赖任何人记忆细节重新拼凑"——新增第三个二进制如果不同步补一条同格式条目，MANIFEST.txt 会立刻出现"两份有记录、一份没有"的不一致状态，跟它自己的设计初衷矛盾。建议照抄现有格式补一条，用途/验证栏先写"v1.0.0 版本化留档，尚未接线到任何调用点，等 NWT 确认锚点后再补验证记录"，不虚构一个还不存在的验证结果。
5. **写 provenance 页**：`docs/provenance/<执行日期>-kanetui-silverc-v100-versioned-copy/`，记录来源路径、commit（全 40 位 hash + tag）、SHA256（复制前后各一次）、复制时间戳、目标路径——同本 session 已有的 provenance 目录惯例（如 `docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/`）。
6. **`kanet.mainnet.env` 加一行**：
   ```
   SILVERC_V100_PATH=D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe
   ```
   **不改动** `SILVERC_ZK_PATH`（Bettor 1216 明确要求，本页照做，且当前 `kanet.env`/`kanet.mainnet.env` 里其实都没有 `SILVERC_ZK_PATH`/`SILVERC_LEGACY_PATH` 这两行——两者现在完全靠代码里的硬编码 fallback 默认值工作，`kasia-console/src/lib/closezk-v2-mint.mjs:16` 等 9 处调用点都是 `process.env.SILVERC_ZK_PATH || 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe'` 这个形状）。
   🔴 **这一步目前不改变任何运行时行为**——本人已 grep 全仓 `SILVERC_V100_PATH`，**零命中**：没有任何代码读取这个变量。写这行只是把路径提前声明好、留证据，等未来真的有调用点决定要用 v1.0.0 编译器时，直接读这个 env 就有值，不需要临时现改 env 文件——跟 §0"锚点未定"这件事一致，本页不代为决定任何调用点要不要切换到 v1.0.0。

## 3. 回滚

任何一步做错：
- 复制的新文件（`silverc-v100-3ed9733.exe`）直接删除，不影响既有两个二进制。
- MANIFEST.txt 新增条目是纯文本追加，`git diff`/手动去掉对应段落即可复原（该文件本身不在 git 仓库里——`D:/silverscript` 不是 `kanet-tn12` 仓库的一部分，是独立本地目录，没有版本控制保护，所以复制/改动前的 sha256 记录格外重要，出错了没有 `git revert` 可用，只能靠这份记录和留档手动核对复原）。
- `kanet.mainnet.env` 那一行是新增独立一行，删掉即可，不影响其它配置（该文件本身 gitignored，同样没有 git 版本历史，改动前后建议留一份 diff 到本次的 provenance 页）。
- 这一整套动作都不涉及任何链上交易/资金/私钥，纯本地文件操作，风险面本身就很小——回滚的主要成本是"没有 git 保护、要手动核对"，不是"资金/密钥暴露"。

## 4. 阻断前提

**NWT 先确认锚点，再执行**（Bettor 1216 原话）——本页把"确认锚点"理解为至少覆盖两件事，供 NWT 审时对照：① 这个 v1.0.0 二进制的来源可追溯链条（§0 表格）本身有没有问题；② "先声明 env、暂不接线任何调用点"这个做法本身是否可接受，还是 NWT 认为应该等到确定了具体调用点之后再一起做（避免出现"声明了但没人用、以后忘了它存在"这种半途状态）——本页不代为在②上拍板，两种做法各有理由，留给 NWT 判断哪个更合适。

第 2 批迁移仍按 Bettor 1207/既有安排等 Owner 令，跟本页无关，互不阻塞。
