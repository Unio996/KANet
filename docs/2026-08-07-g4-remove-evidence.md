# G4-SETTLER-CHAIN-REDERIVE-BRANCH 移除 · 证据文档

> **Status**: CURRENT · 证据文档(非设计稿)· 记录 `f5084779` 移除动作的依据 · **零链上 · 零生产 DB 写**
> **作者**: J2 · 2026-08-07 · **审**: NWT(独立复跑 Q3/consumer grep)· **批**: Bettor · **外审**: Codex `45425b9b`(认定为正确的 fail-closed dearming)
> **缘起**: 本文件由 Codex `45425b9b` 第 1 条要求落库 —— 原证据包在 `scratch/`(**gitignored**),
> **对本机队友可读 ≠ 对跨仓读者可读**,不构成交付。

**对象**:`kasia-console/src/services/pool-market-settler.js` 的 **cross-node chain re-derive 分支**(`pathBReconciled`,旧称 "Path B")。
⚠ **与 `m0c-1 Path B 围栏`**(`docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md` —— custodial_transfer 托管围栏 / grant registry `source_scope` / gateway 限流)**毫无关系**。同名两物,勿混。

---

## 1. 身份锚(读本文件的数之前先对这一节)

| 项 | 值 |
|---|---|
| 分支 | `bshard-m3-deploy` |
| 移除 commit | `f5084779` |
| 采集时 HEAD | `f5084779` |
| DB | `D:/kanet-tn12/kasia-console/data/console.db`(**本机**) |
| schema 锚 | 🔴 **库里没有可查询的 schema 版本**:`PRAGMA user_version = 0`,无 `schema_migrations` 表。<br>唯一锚是源码侧 `src/db/migrate.js` 的最高版本标记 **v194**。**⇒ 本文件的读数无法与某个 schema 版本硬绑定,如实标。** |
| 采集时刻 | 2026-08-07(Q1/Q2/Q4 于 ~08:2xZ;Q3 复采于 ~09:1xZ,见 §2 波动注) |

---

## 2. 运行时观察(**易变**,读数会随时间变)

> 🔴 **本节所有数字都是【某一时刻的运行时快照】,不是不变量。**
> 实证:`kaspa_tx_log` 行数在**约一小时内**从 `14,928,354` 变为 `14,937,554`(+9,200)。
> ⇒ **这正是这些计数【不能写进源码注释】的理由**(Codex 第 2 条):过期计数会被下一个读者当成现行不变量。

### Q1 — 当前符合该分支选择条件的市场数

```sql
SELECT COUNT(*) AS n FROM pool_markets
 WHERE protocol_status IN ('verifying','collecting_sigs')
   AND maker_relay_id LIKE 'cross-node:%'
   AND settle_txid IS NULL
   AND refund_txid IS NULL;
```
| n |
|---|
| 0 |

### Q2 — 全部 cross-node 市场的终态写入痕迹

```sql
SELECT protocol_status, COUNT(*) AS n,
       SUM(CASE WHEN settle_txid IS NOT NULL THEN 1 ELSE 0 END) AS with_settle,
       SUM(CASE WHEN refund_txid IS NOT NULL THEN 1 ELSE 0 END) AS with_refund
  FROM pool_markets WHERE maker_relay_id LIKE 'cross-node:%'
 GROUP BY protocol_status ORDER BY n DESC;
```
| protocol_status | n | with_settle | with_refund |
|---|---|---|---|
| cancelled | 7 | 0 | 0 |
| archived | 6 | 0 | 0 |
| unresolved_needs_authorization | 4 | 0 | 0 |

### Q3 — `kaspa_tx_log.from_address` 的填充情况

```sql
SELECT COUNT(*) AS total,
       SUM(CASE WHEN from_address IS NOT NULL AND from_address <> '' THEN 1 ELSE 0 END) AS non_empty
  FROM kaspa_tx_log;
```
| total | non_empty |
|---|---|
| 14,937,554 | **0** |

⚠ `IS NOT NULL` **单独用会把空串算作有值**;本查询用 `<> ''` 双条件,两类分开数。

### Q4 — 有多少市场的 spine 地址能命中 `from_address`

```sql
SELECT COUNT(*) AS n FROM pool_markets m
 WHERE EXISTS (SELECT 1 FROM kaspa_tx_log t WHERE t.from_address = m.spine_p2sh);
```
| n |
|---|
| 0 |

### 结果摘要 digest

对 Q1–Q4 的 `{label, sql, rows}` 规范化 JSON 取 sha256:

```
09934ffb4b7ccc2f1b6457563f33d3a2d683ee3e0ad0903fe8a9c12f75f41625
```
⚠ **该 digest 只锚"这一次采集的这组读数"**;Q3 会随索引增长而变 ⇒ **重跑后 digest 必然不同,这是预期,不是异常。**

---

## 3. 源码事实(**稳定**,不随时间变;与 §2 分栏是 Codex 第 1 条的要求)

| # | 事实 | 出处 |
|---|---|---|
| S1 | 该分支用 `WHERE from_address = <spine_p2sh> ORDER BY block_time DESC LIMIT 1` **搜出一笔交易**,再**仅凭其输出个数**写终态(`>=2 ⇒ completed` / `==1 ⇒ refunded`) | 移除前 `pool-market-settler.js` L1430–1485(见 `f5084779^`) |
| S2 | 它**从未核实**那笔交易花的是不是该市场的 spine outpoint | 同上(全段无 outpoint 比对) |
| S3 | `from_address` **不是权威归因** | ST-06 G-4:display-only |
| S4 | ingest 管道**端到端已就位,只差调用方传值** | `kasia-console/src/api/ingest.js:40`(解构 `fromAddress`)、`:55`(`fromAddress \|\| null` 写入);`kasia-relay/src/ingest.mjs:122`(签名含 `fromAddress`)、`:127`(`fromAddress \|\| null`) |

🔴 **S4 是"必须移除而非加 disabled 标记"的理由**:该分支今日的安全**不来自它自己**,来自 `from_address` 未被填充;而填充它**看起来只是修一个 display-only 小缺陷**,做那个改动的人**没有理由会想到这里**。disabled 标记不会因别人改 ingest 而收紧;**移除才拆得掉这条因果链。**

---

## 4. 结论(两句分开,不合并)

1. **行为零变化 —— 而这句的强度按 Codex `a19087c7` 降级,原文照录**:
   > **被检本机留存数据集上 `from_address` 无非空行,故被移除查询无可匹配行;留存 cross-node 市场集无 settle/refund txid 终态写痕;分支历史调用本身、其他节点与已不留存数据上的行为,双向皆未证。**

   🔴 **我原写的是「该分支在生产中从未执行过」—— 那句强于证据可证,四条理由(Codex,全部成立)**:
   - **现态查询 ≠ 历史执行台账** —— §2 是"现在长什么样",不是"历史上发生过什么";
   - **留存表未证 append-only、也未证与全节点一致** —— 本机 `kaspa_tx_log` 可能不是当时的全量;
   - 🔴 **"进分支、查空、continue"本身就是一次执行** —— 该分支**每 tick 都在跑**,只是没匹配到行。**"从未执行"字面即假**;
   - **Q2 只证"记录字段缺席"**,不证"写入动作从未发生"。

   ⇒ ✅ **而这不削弱移除理由**(Codex 自述): **不安全的推断链是【代码实况】,拆弹与历史上有没有击发无关。**
2. **接口形状变化,影响为零** —— tick 返回对象少一个键 `pathBReconciled`(见 §5)。

---

## 5. `pathBReconciled` 消费者审计(Codex 第 3 条)

- **做法**:全仓 grep `pathBReconciled`。
- **结果**:**仅命中 `pool-market-settler.js` 自身**(定义处 + 返回对象)。**NWT 独立复跑一致。**
- 🔴 **作用域诚实**:这句只覆盖**本仓可见范围**。**仓外消费者(别的 checkout / 外部集成 / 未入库脚本)无法证否** —— 我**不主张**"全世界零消费方"。
- **返回契约变更(一句)**:`poolSettlerTick()` 的返回对象**不再包含 `pathBReconciled` 键**;其余键不变。
- **处置**:**不恢复该键**(恢复会把已拆掉的概念引回来);按**兼容性小变更**记账,即本节。

---

## 6. 回归证据(`logs/` 同样 gitignored ⇒ 摘要 + digest 入库)

改动落在 settler 共享文件 ⇒ 重跑两条既有 P1 用例:

| 用例 | 结果 | trace 文件 | sha256(前 16) |
|---|---|---|---|
| `p1_refund_authorization_gate` | **1 PASS / 0 FAIL** | `logs/test-runs/2026-08-07T08-30-04_p1_refund_authorization_gate.log` | `efd80dc9e40b456b…` |
| `p1_bypass_authorization_e2e` | **1 PASS / 0 FAIL** | `logs/test-runs/2026-08-07T08-30-04_p1_bypass_authorization_e2e.log` | `df915e37503f61a3…` |

⚠ **本仓无自动回归**(无 CI/cron):以上是**改动者手工跑**的证据,`logs/test-runs/` 为**覆盖式**(只留最后一次)⇒ **digest 是这两份 trace 当时内容的锚**,重跑会覆盖原文件。

---

## 7. 移除的是危险,不是需求

那些 cross-node 市场**仍需要真正的对账能力** ⇒ 归 **G-4 本体(Codex 九项最低清单)独立 OPEN**。
在它建成前,这些市场终态保持 **`unresolved` / manual-evidence-required(诚实态)**,**不由 settler 猜**。

## 8. 作用域限制(全文适用)

1. §2 全部读数取自**本机** `console.db` 与本机 `kaspa_tx_log`;**其它节点该列可能已填** ⇒ **"结构上跑不起来"这句限本机**。
2. §4 第 1 条为真 ⇒ **无历史写入可供逐笔上链核对** ⇒ 发作检查是**"核无可核"**,不是"核过了没问题"。
3. §5 的消费者审计**限仓内可见范围**。
