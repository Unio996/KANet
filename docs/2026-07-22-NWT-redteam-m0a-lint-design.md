# M0a 裸 import 差分 lint 设计稿 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-22 · NWT）
> **审对象**：`docs/2026-07-22-m0a-bare-import-differential-lint-design.md`（KANet-UI，commit `c5992005`）
> **立场**：红队默认 refute——门是用来被绕的，先假设能绕过再证拦得住。设计整体扎实（form 指纹归 basename 堵相对前缀改写这个坑抓得准、shrink-only 不变量、manifest path 锚定 + 静态 capability 限制、扫 staged 内容防私货都对），本卡只打**能绕过 lint 的路径**。
> **verdict**：**GREEN-with-1-MUST-FIX** + §9 三个开放问题裁定如下。

---

## MUST-FIX：标量多重集 count 有 delete-and-add 平衡漏报，R-M0A-SHADOW-MODULE 不闭合

**攻击（打穿了，实测坐实前提）**：
判据是"全仓某 form 的 count vs 冻结 baseline count"（§3.2 表）。**form 归一到 basename 后大量塌缩**——实测 `git grep` 归一化：`import Database from better-sqlite3` **116 处共享同一 form**，`const Database=require(better-sqlite3)` 26 处，`import Db from better-sqlite3` 21 处。form 不是稀疏的，是高度碰撞的。

漏报链（跨 commit，甚至不需同一人）：
1. commit 1：合法燃尽——删掉 116 个同 form occurrence 里的任意一个。repo count 116→115，baseline 仍 116（§3.2"count 减少 PASS"，且 baseline 只在显式 `--regen` 才收缩，无人 regen）。**冻结 baseline 现在银行了 1 个 headroom。**
2. commit 2：新文件（任意路径，含本不该碰 DB 的 `src/api/` 新模块）加一行 `import Database from better-sqlite3`。repo count 115→116。判定 `116 > baseline 116`？**否，等于，PASS**。

**新增裸 import 落进了一个全新文件却零报警**——恰好是 M0a 要堵的头号目标（存量主体新增裸连）。**每一次未立即 `--regen` 的合法燃尽都在冻结 baseline 上存一格可复用 headroom**，form 越塌缩额度越大（sqlite 族单 form 就有 116 格潜在缓冲）。

**为什么 §9.3 的 R-M0A-SHADOW-MODULE 不闭合它**：那条规则禁"新建与守门模块同 basename 的文件"，针对的是"造 `relay-manager.js` 冒充"。但本攻击**不需要任何同名文件**——它复用的是 better-sqlite3 这个真实第三方包的 form，新文件叫什么都行。shadow-module 是另一个子案，管不到 count-balance。

**根因**：标量 count 无法区分"移动 A→B"（KANet-UI 要靠 count 不变来免误报）和"删 A 加无关 B"（本攻击）——因为 form 塌缩后两者在 count 维度**完全同形**。§3.3 把 path 主动降级成"informational，只影响提示精度，永不产生误报/漏报"——**这个降级正是漏报的来源**。path/location 身份在 form 塌缩的现实下是承重的，不能降级。

**修法方向（给 KANet-UI 选，不替你定实现）**：
- **首选：git rename 检测做判据核心**。`git diff --cached -M` 把移动/改名识别为 rename pair（R）——rename 的裸 import 视为身份延续（免误报，且相对前缀改写正好被 -M 的相似度匹配吸收）；纯 Add(A) 且引入 baseline 外 occurrence = ERROR（闭合 delete-and-add：删是 D、加是 A，git 不会把语义无关的两个 blob 配成 rename）。这比标量 count 同时更准（免误报）更严（堵漏报）。
- **次选（若坚持 count 模型）：把"count 减少"从静默 PASS 改成"必须同 commit `--regen` 落账"**——即 `repo_count ≠ baseline+manifest 额度` 一律 ERROR（增=拒、减=要求 regen 银行清零）。这样燃尽必须显式收缩 baseline，headroom 无法跨 commit 累积。**残留**：同一 commit 内 delete A + add B 仍 count 平衡蒙混——所以次选不如首选干净，git rename 检测才根治。

任一修法都要进 §8 负向测试：新增"删一处旧 + 加一处新文件裸 import，净 count 不变 → 必须 ERROR"这条（现清单第 3 条只测纯移动 PASS，没测这条对偶的漏报面）。

---

## §9 三个开放问题裁定

**① 新增测试文件摩擦度 → 裁：接受摩擦（同意 KANet-UI），但开一条"自助只读测试道"降摩擦，不设目录豁免。**
目录放行 = 规则 58 病（按命名给豁免），拒绝，KANet-UI 判断对。但"每个新 DB 回归测试登记一条 manifest + 人审 review_ref"摩擦确实会逼人绕路（写进 scratch 或不写测试，反噬测试文化）。折中：`test-fixture` capability 的**静态限制**（文件在 `test-framework/` 或 `*.test.*` 下 **且** 每个 `new Database` 带 `readonly:true`）**可替代人审 review_ref**——静态可核的约束本身就是审查，让只读测试夹具自助登记（manifest 条目仍要，保持显式登记不塌成目录豁免，但 review_ref 对这一类填 `self-serve:readonly-test` 而非等人批）。非只读的测试连接照旧走人审。这样摩擦落在"真要写连生产库的测试"上，正是该有摩擦的地方。

**② 注释剥离深度 → 裁：行首启发够用（同意），但 name 已知残留，不扩大 lint 承诺。**
单源函数两侧一致偏，不产生差分噪音，判断对。真正的漏报面不在注释深度而在**动态/拼接 require**（`require(variable)`、`require('better-sql'+'ite3')`、`await import(computed)`）——正则天然抓不到，AST 也难。这类是 lint tripwire 的固有盲区，M0a 是"入库闸的纵深一道"非唯一门（§6.2 已诚实声明只守入库不守物理运行），可接受为**已知残留**，写进设计稿"不承诺覆盖"节即可，别为它上 AST（成本不划算）。行首启发 pass。

**③ form 归一化粒度 / R-M0A-SHADOW-MODULE → 裁：shadow-module 首批带上，但它不是 MUST-FIX 的替代。**
R-M0A-SHADOW-MODULE（禁新建同 basename 守门模块文件）本身值得带（+15 行，堵 basename 冒充这个真实子面），**同意首批带**。但如上 MUST-FIX 所述，它**不闭合 count-balance 主漏报**——两者是不同攻击面。首批应**同时**带 shadow-module + MUST-FIX 的 path 身份修法（git rename 检测优先）。别用 shadow-module 顶替 MUST-FIX 交差。

---

## PASS 的部分（挣来的）

- **form 归 basename 堵相对前缀改写**（§3.1 第三条隐藏坑）——KANet-UI 主动点出并正确处理，这是设计里最见功力的一处，PASS。
- **manifest path 锚定（与 baseline 反向）+ capability 静态限制 + relay-manager 族不开 ops 口**——逐条经审、fail-closed（文件移动 manifest 不同步即报错）、不设目录豁免，正确应用规则 58 教训，PASS。
- **扫 staged/index 版本防 working-tree 干净藏私货**（§6.2）——攻击者视角该堵的都堵了，PASS。
- **shrink-only 不变量（R-M0A-BASELINE-SHRINK-ONLY）**堵"顺手 baseline+1"——对，但注意它只堵 baseline 文件被写增，堵不住上面 count-balance（那个不改 baseline），两者别混为一谈。

---

## 交付后

- 本 verdict 不阻塞第一波 DoD"三件齐进 M-1 内部审"——M0a 是 design 步，MUST-FIX 在**落码前**修（实现批 design→code→diff 审链里带上），不是现在返工设计稿。KANet-UI v0.2 收敛 MUST-FIX + 三裁定后，实现批我再审 diff。
- **关联**：`docs/2026-07-22-m0a-bare-import-differential-lint-design.md`（审对象）、`docs/ANTI-PATTERNS.md` 规则 58（黑白名单枚举不完备）。
