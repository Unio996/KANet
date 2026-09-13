# NWT 红队复核 · F2-R ambiguous-hold（Codex 3ce6513a MUST-FIX）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-f2r-ambiguous-hold` `649c3013`（基线 `16e56349`）。
> 方法：独立 worktree + 独立 `npm install`；**亲自跑**了完整 `submit-intent.test.mjs`(含新增向量)；**亲自跑**了 v204 迁移的三种场景(全新库/幂等重跑)；逐个查了"AMBIGUOUS 会不会被推进"这条链路的每一个可能入口，不是只看 `resolvePrepared` 那一处。

## 结论：**GREEN，可以合入**

## 一、①AMBIGUOUS 是否真无任何路径再付——查了三个可能入口，全部确认拦住

**入口 1：同 offer 再调用 `transferWithIntent`**——读了 diff,新加的 `if (row.status === 'ambiguous') throw new IntentHoldError(...)` 挡在"pending⇒fresh send"分支之前;`ensureIntent` 是 `INSERT OR IGNORE` 按确定性 `intent_key` 幂等,同 key 再调用只会取回已经是 `ambiguous` 的那一行,不会生出一个新 `pending` 行绕过去。**PASS**。

**入口 2：F3 对账器(`tx-landed-reconciler.mjs`)会不会把 AMBIGUOUS 行推进**——直接读了这个文件的两处 `listIntents({status:...})` 调用,一处查 `'submitted'`,一处查 `'prepared'`,**从未查过 `'ambiguous'`**——结构上就摸不到这些行,不是"逻辑上不处理",是"查询条件里根本不包含"。**PASS**。

**入口 3：`resumeStaleIntents`(重启捡回)**——同样只查 `status:'prepared'`,不含 `ambiguous`。**PASS**。

**`markIntent` 本身的终态锁**：`TERMINAL(s) = s==='abandoned' || s==='ambiguous'`,任何 `k==='status'` 的写入只要当前行已经是终态就被跳过——这条锁是在写入函数这一层挡的,不依赖调用方"记得判断",双重保险。

**结论**：三个可能被想到的入口(直接重入、F3 对账、重启捡回)都独立核实拦住了,AMBIGUOUS 是真终态,不是名义上的终态。

## 二、②kaspa_tx_log 命中作正证据是否够——够，且失败方向是安全的那一侧

正证据判据是 `SELECT 1 FROM kaspa_tx_log WHERE tx_id = ? AND to_address = ?`——**假阳性不可能**：`tx_id` 是这张表的主键,要让这个查询命中,必须真的存在一行 `tx_id` 恰好等于 `prepared_txid` 的记录,而 Kaspa 的 txid 是加密哈希,不存在"凑巧撞上"这种可能性——命中就是真的命中,这条查询本身不构成攻击面。

**真正的问题方向是漏报**：`kaspa_tx_log` 只覆盖三类 watched 地址(本地 relay 地址 / 近 30 天 exchange 对手方 / 近 30 天活跃 identity),读了 `api/ingest.js:147-175` 确认这三类的具体来源。查了 `transferWithIntent` 的实际调用方(`bettor.js` 的 escrow 锁仓地址、`prediction-payout-gate.mjs` 的赢家收款地址)——这些目标地址**大概率**落在类别(1)/(2)里,但不是结构上保证的(比如赢家收款地址如果不等于该 offer 的 `maker`/`taker` 字段,就可能落在覆盖范围外)。**这个覆盖缺口本身不是安全问题**：漏报的后果是"真安全的情况也判成 AMBIGUOUS,要人工清一次"，不是"不安全的情况被误判成安全"——失败方向已经选在了保守的那一侧,跟这段代码自己注释写的"未命中经常只是没被盯上,不代表没有别的tx"一致。**PASS,但记一条非阻塞的运营观察**：如果赢家/收款地址经常落在 watched 集之外,AMBIGUOUS 的人工清单会比"严格必要"更长一些,这是设计已知的代价,不是缺陷,只是提前告知 Bettor/J2 别对 AMBIGUOUS 出现频率感到意外。

## 三、③六步负向量真跑——亲自跑了，不是读测试代码信

独立 worktree + 独立 `npm install` 后跑了完整 `submit-intent.test.mjs`（26 条断言 + harness 翻转臂，全部贴出核对过一遍，不止看数字）：

```
✅ F2-R-3: inputs_spent 三缺 + kaspa_tx_log 无命中 → AMBIGUOUS/HOLD, 不 abandon 不建 #2, 零广播
✅ F2-R-3-续: ambiguous 行再入口 → 继续 hold, 不会绕过去补付
✅ F2-R-3-正证据: kaspa_tx_log 命中 prepared_txid → submitted, 不进 AMBIGUOUS 不重建
✅ Codex 六步负向量: 广播落地+回执丢+收款方先花+目标UTXO查无+输入缺失 ⇒ 不建 attempt #2, 零付款, HOLD
```
四条关键向量全部真绿，其余既有向量(F2-正/F2-幂等/F2-I5系列/F2-E系列/F2-R-1/F2-R-2/弱注入系列等)没有因为这次改动而回归。**PASS**。

## 四、④v204 迁移对全新库与已有库两态——亲自跑了两种场景

**全新库**：`DB_PATH` 指向一个不存在的路径,跑一次 `run-migrations.mjs`,日志打出 `v204: submit_intents rebuilt (0 rows preserved, 2 indexes recreated, CHECK 加 'ambiguous')`；查表结构确认 `CHECK (status IN ('pending','prepared','submitted','landed','abandoned','ambiguous')`，行数 0。**PASS**。

**幂等重跑(已迁移库再跑一次)**：对同一个刚迁移完的文件再跑一次 `run-migrations.mjs`——v201/v202/v203 各自打出"已存在,记账通过"式的守卫日志，**v204 这一段完全没有输出**（确认 `!currentCheckStates.includes('ambiguous')` 这个前置判断正确短路跳过了整段重建逻辑，不是跑了但恰好没变化），迁移后再查表结构，CHECK 子句原样不变、没有重复迁移的痕迹。**PASS，幂等正确**。

**代码层面确认的第三态(已有真实行的库升级)**：没有单独构造这个场景(成本较高)，但读了迁移代码本身——用 `PRAGMA table_info` 动态取列名建 `INSERT INTO ... SELECT`（不是硬编码列表，不会因为漏抄一列丢数据），迁移前后有显式 `rowCountBefore`/`rowCountAfter` 比对，不等则 `throw` 触发 `ROLLBACK`——这条防线是结构性的，不依赖"希望没漏"。**这部分判定为设计上安全，不是亲测覆盖，如实标注**。

## 五、给 Bettor 的处置建议

- **GREEN，可以合入**。①②③④ 四点全部核实通过，其中①③④做了亲自动手验证(不是读代码/读测试文件信)，②的漏报方向确认是安全侧、附一条非阻塞运营观察。
- 一条记档(不阻塞)：赢家/收款地址若经常落在 `kaspa_tx_log` watched 集之外，AMBIGUOUS 人工清单会比严格必要更长，这是已知设计代价，不是缺陷。
