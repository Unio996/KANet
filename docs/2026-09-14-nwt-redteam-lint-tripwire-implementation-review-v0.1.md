# NWT 红队复核 · R-CTOR-ONLY-ASSIGNMENT-TRIPWIRE lint实现(`9eca3fbc`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1206：lint规则实现`coord/kanetui-lint-tripwire@9eca3fbc`。审点：①lint-kanet集成点真的会在正式
> lint路径执行；②git ls-files范围是否漏untracked新.sil；③正则与1205测过的`int closed = init_closed;`
> 形一致；④错误信息措辞。

## 结论：**GREEN，四个审点全部独立验证通过，附一条非阻断的设计考量（provenance目录范围）供Bettor/KANet-UI
判断是否需要处理。可以合入主线。**

## 一、①集成点真的在正式lint路径执行——独立读源码+独立跑通全链路确认

**独立读了`scripts/lint-kanet.mjs`的调用结构**：`checkR_CTOR_ONLY_ASSIGNMENT_TRIPWIRE()`跟
`checkR10()`/`checkR_NULLIFIER_I64()`/`checkR_COMMAND_REGISTRATION()`同层级、在同一段顶层无条件调用序列
里，不在任何`if`/`for (const fp of targets)`条件分支内——跟这个文件里其它"仓库级不变量"检查（不依赖argv
传的文件列表，自己内部决定扫描范围）用的是同一种接线方式，不是特例。任何`violate()`调用都会push进模块级
`violations`数组，文件末尾无条件`if (violations.length > 0) ... process.exit(1)`——**确认这条规则命中
一次就会让`node scripts/lint-kanet.mjs`不管以什么参数调用都以exit 1收尾，不是只在测试文件里才生效**。

**独立跑了一次真实端到端**（不是信commit message"另做了一次真实端到端验证"这句话，是自己重新做的，用
不同的fixture）：`git worktree add`到`9eca3fbc`独立跑了`node scripts/r-ctor-only-assignment-tripwire.test.mjs`
——15/15全部通过，跟claim数字一致。随后自己另建一个真实tracked fixture文件（第一次踩了自己的坑：文件名
带`_`前缀被`.gitignore:24 _*`规则挡了，`git add`静默不生效，第一次测试因此得到了假的"0命中"——发现后换
成不带下划线前缀的文件名重测），`git add`后跑`node scripts/lint-kanet.mjs`：**确认真实报
`R-CTOR-ONLY-ASSIGNMENT-TRIPWIRE: 1 hit(s)`，exit=1，`file:line`精确落在fixture的第3行**；移除fixture
（`git reset` unstage + 删文件）后重跑确认恢复0命中。**①确认GREEN。**

## 二、②git ls-files范围——独立验证边界所在，判断"可接受"

**独立验证了三种场景**（在①的同一个worktree里）：
1. 一个**完全untracked（从未`git add`）**的违规文件——`git status`显示`??`，`node scripts/lint-kanet.mjs`
   **不报错**——确认这个边界是真实存在的，不是猜测。
2. 一个**已`git add`但尚未commit**的新违规文件——`git ls-files -- '*.sil'`**能看到它**，
   `node scripts/lint-kanet.mjs`**确认报错**——证明"staged即可被捕获"，不需要先有一次commit。
3. `git ls-files -- '*.sil'`（不加路径限定）确认递归扫描全仓（59个`.sil`文件分布在
   `kasia-console/src/lib`、`kasia-console/src/lib/sil-v1`、根目录一个`_j2_closezk_repro4.sil`、以及
   多个`docs/provenance/`历史归档子目录），不是只扫一个固定目录。

**结论：这个边界（只漏"从未`git add`过的文件"）是可接受的**——lint-kanet作为"commit前拦截"的门，其
职责边界本来就是"要进这次commit的内容"，而任何要进commit的内容必然先经过`git add`（无论是pre-commit
hook触发时机还是手动跑）——一个永远不`git add`的文件本身就不会被这次commit影响，不在这个门该管的范围内。
且这不是本规则独创的新范围，是这个文件本身`v6`（2026-08-29 Bettor裁）已经确立的仓库级约定
（"无参默认范围：只扫git tracked文件"），本规则只是复用既有约定，不是新开一个更松的口子。

**一条非阻断的设计考量（值得记录，不代为裁定）**：`git ls-files`范围包含`docs/provenance/`下的历史`.sil`
归档快照——这些文件按本项目的provenance纪律是**只读、永久保留的历史证据**（记录某次commit当时的源码
状态），理论上如果任何一份更早期的历史快照（比如Q8裁决之前的某个早期草稿）恰好包含这三个字段的真实赋值
语句，这条lint规则会把它当成"现在违反了tripwire前提"报错——**而且报错后没有干净的修复路径**：不能改
历史归档文件（违反append-only的provenance纪律），也不能按规则本身的措辞"自行加白名单跳过"（措辞明确禁止
不经NWT复核就加例外）。**本次实测59个文件（含全部provenance归档）当前是0命中**，不是一个正在发生的问题，
但如果Bettor/KANet-UI希望防患于未然，可以考虑给规则加一条`docs/provenance/`路径排除（历史证据不代表
"当前生效的合约代码"，排除它不会削弱tripwire保护"当前代码零赋值"这条真正关心的事）——**这条建议是可选的
加固，不是MUST-FIX，不阻断本次合入**。

## 三、③正则一致性——独立验证匹配1205测过的ctor→state规范写法

独立调用`findCtorOnlyTripwireHits()`喂入`byte[32] poolMerkleRoot = init_poolMerkleRoot;`和
`byte[32] predicate_commit = init_predicate_commit;`两行——**两次都正确命中对应字段**，跟我在1205那次
（T4 v0.3/v0.4复核）用同样手法（针对`CloseZkV2.sil`真实存在的`int closed = init_closed;`这类写法构造
合成测试）验证过的结论一致——这条lint实现的正则跟设计文档v0.4 §1.3的正则字面相同
（`\b(poolMerkleRoot|committee_hash|predicate_commit)\s*=(?!=)`），行为也确认一致，不是"看起来像但实际
实现走样"。**③确认GREEN。**

## 四、④错误信息措辞——独立读取完整文本（非console截断版），准确

从源码里直接读了`violate()`调用传入的完整字符串（console输出本身会把长消息截到200字符，不能只看终端
打印那一份）：完整文本准确引用了T4 v0.4文档路径与"§1"章节、准确描述了"这个赋值语句打破了(c)+(d)覆盖
论证的前提"这条因果关系、明确要求"必须先叫NWT复核"且"不可自行加白名单跳过"——跟v0.4设计稿§1.3提议的
提示语文案精神一致，没有走样或弱化措辞。**唯一一个可以更精确但不算错的小地方**：消息引用的是文档"§1"，
tripwire设计其实具体落在"§1.3"这个子节——引用到父节而非具体子节不影响读者定位（§1本身就是tripwire整节
的标题），不算错误，不需要因此打回。另外确认了`git ls-files`本身执行失败时也会走`violate()`
（fail-closed，"门不许静默失效"），不是只有命中才会报，这条防御性设计也核对过，属实。**④确认GREEN。**

## 五、给Bettor的处置建议

- **四个审点全部GREEN，可以合入主线**。
- 建议（非阻断）：考虑给规则加`docs/provenance/`路径排除，理由见§二——防止未来某份历史归档快照被追溯性
  地判定为"违反tripwire"却没有干净的修复路径；这条不影响本次合入决定，可以作为后续小改动单独处理。
- 测试文件`r-ctor-only-assignment-tripwire.test.mjs`本身15/15独立复现，我自己另建的两组fixture（untracked
  一次+staged一次）也全部符合预期，没有发现设计文档与实际实现之间的落差。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
