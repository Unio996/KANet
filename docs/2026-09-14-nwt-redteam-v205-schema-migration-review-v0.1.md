# NWT 红队复核 · v205 schema迁移(`f09fcb31`)——payout_shards/market_shards代币化ctor-only列

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1229：D-019第5a笔。审点：①幂等(fresh DB两次跑)；②NULL语义与1227一致(缺值fail-loud责任在5b
> 读方)；③列名与T3 v0.4§2/T4清单命名一致；④DATABASE.md记录准确。

## 结论：**四审点全部独立验证GREEN。①独立跑fresh DB两次——第一次4列全加上，第二次exit 0、零重复、无
duplicate column报错，真实幂等（不是只信commit message"实测fresh DB首次跑...二次跑无重复报错"这句话，
是自己重新跑了一遍）。②独立`pragma table_info`确认三列全部`notnull:0`+`dflt_value:null`，纯TEXT允许
NULL，无猜测默认值，"缺值fail-loud"的责任确实完全交给了读方（本迁移本身不做任何值填充/猜测）。③列名
跟对应`.sil`源码ctor字段名核对：`payout_shards`三列跟`PayoutShard.sil`/`PayoutShardV2.sil`源码里的字段
名逐字相同；`market_shards`的`shard_token_tmpl_hash`是有意的、非字面对应`ShardLeaf.sil`里`token_tmpl_
hash`这个裸字段名的改写（加`shard_`前缀区分"这是ShardLeaf自己那份、不是PayoutShard那份"），判断为合理
的设计选择不是命名不一致。④DATABASE.md独立读了完整diff，跟migrate.js代码逐条对得上，状态注记正确
append而非改写既有陷阱正文，版本历史缺口如实披露。**

## 一、①幂等——独立fresh DB两次跑，非信commit message

独立`git worktree`到`f09fcb31`，`npm install`后指向一个全新临时DB文件，直接`import`该commit的
`migrate.js`跑`runMigrations()`两次：

- **第1次**：日志确认v205四行全部打印（"payout_shards.token_tmpl_hash列已加"等），一路跑到"DB migrations
  complete"，无异常。
- **第2次（同一个DB文件，未清空）**：**exit code 0**，无任何"duplicate column"报错，v205没有再打印任何
  新增日志（跟v200/v201的"在,记账通过"式确认日志不同，v205选择静默跳过——这是一处非阻断的风格不一致，
  见§五，不影响幂等性本身）。
- 独立`pragma table_info`核对：四列**各自恰好存在一次**（不是被重复ADD导致的多列或报错），确认真实幂等，
  不是"报了错但恰好不影响结果"这种假幂等。

## 二、②NULL语义——独立核对，缺值责任确实在读方（5b范围）

独立读取`payout_shards`三个新列的`table_info`：`notnull:0`（允许NULL）、`dflt_value:null`（无DEFAULT，
不猜任何值）——**跟commit message描述的"全部TEXT允许NULL、无DEFAULT猜测值"逐字一致**。这条设计的意图
（K-18"谁编译谁declare"纪律的延伸）是：**这次migration本身不做任何值填充**，缺值时读到的就是真实的
`NULL`，"消费方读到NULL必须fail-loud拒绝"这条责任完全落在**下游读方**（`compilePayoutShardRedeem`/
`compilePayoutShardV2Redeem`/`compileShardLeafRedeem`结算重编译路径）——这正是5b要审的那半，本次
（5a）只确认"schema允许NULL、不掩盖缺失"这个前提本身立住了，跟1227转述的裁定一致。

## 三、③列名一致性——独立核对，`shard_`前缀是有意设计不是不一致

独立`grep`了`ShardLeaf.sil`/`PayoutShard.sil`两份源码的ctor字段声明：`PayoutShard.sil`的`token_tmpl_hash`/
`claim_tmpl_hash`/`market_suffix_hash`跟`payout_shards`表的三个新列名**逐字相同**。`ShardLeaf.sil`的
ctor字段裸名也叫`token_tmpl_hash`（跟`PayoutShard.sil`同名但指向不同文件的不同实例），而`market_shards`
表选择的列名是**`shard_token_tmpl_hash`**（加了`shard_`前缀，不是逐字照抄`.sil`里的裸字段名）——**这条
判断为合理、有意的设计选择，不是命名疏漏**：这两个字段虽然都叫`token_tmpl_hash`，但活在两张不同的表里
（`payout_shards`一行=一个逻辑市场，`market_shards`一行=一个物理片），加前缀能让任何跨表JOIN/日志/
排错场景一眼看出"这是哪个文件的那份"，跟T4 v0.3/v0.4已经建立的"同名不同物必须靠文件名+字段名两段式识别"
这条纪律精神一致（只是这次在DB层用了列名前缀而不是文档里的"全限定名"写法达成同样的效果）。

## 四、④DATABASE.md——独立读完整diff，逐条对得上

- `market_shards`节新增`shard_token_tmpl_hash`说明，跟migrate.js代码描述一致。
- `payout_shards`字段列表追加三个新列说明，且明确写了**写入方**（创世时T4单源产物）+**读取方**
  （`compilePayoutShardRedeem`/`compilePayoutShardV2Redeem`）+**缺值行为**（fail-loud拒结算，不猜
  "现在的全局配置应该还是那个值"）——三件事都在一句话里交代清楚，不是只写"加了三列"就完事。
- **陷阱段落的状态注记是append而非改写**：独立确认原有"payout_redeem_hex的字段布局...改动前必读该文档"
  这段原文一个字没动，新状态注记单独另起一段、带日期+ledger引用，指向另一份独立报备文档——跟本session
  一直要求的"补状态注记不改原话"纪律一致。
- **版本历史/顶部指针的诚实披露**：`v199-v204`的changelog空缺没有被静默隐藏，明确写了"本文件changelog
  未逐条回填...本行只保证指向migrate.js真实末尾版本号"——不是拍胸脯说"都记录好了"。

## 五、非阻断的风格小观察

v205的两个`ALTER TABLE`守卫块在列已存在时**完全静默跳过**（不打印任何"记账通过"式的确认日志），跟
v200/v201的既有风格（"idx_xxx 在, 记账通过"）不完全一致——功能上无影响（幂等性本身已独立验证成立），
但如果以后要靠日志排查"这次migrate到底跑没跑到v205这一段"，静默跳过会比"在,记账通过"少一条可核对的
证据。**不建议为此单独开一笔**，如果5b或后续有别的migrate.js改动顺手带一句也可以，非MUST-FIX。

## 六、给Bettor的处置建议

- **四审点全部GREEN，`f09fcb31`可以确认**。
- 5b（`compilePayoutShardRedeem`/`compileShardLeafRedeem`本体迁移+读方fail-loud）到了我按此前1225说的
  四点（schema向前兼容/fail-loud真throw/R-PS-FAMILY-DISPATCH白名单/既有测试对新编译器）同等强度审。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
