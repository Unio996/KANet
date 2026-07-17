# jepu1 陈签名软失效手术单(正式版, 执行凭据)

> **Status**: CURRENT(待 Owner 签发; 内容三项前置已全预清+双验证, Bettor gate 预过 #pgi9w1)

- 设计依据: `docs/2026-07-18-jepu1-stale-sig-resign-design.md` v1.2(双审 GREEN)+ Codex MSG-20260717-008 六条件
- 拟单: J1tn 2026-07-18 · selector/locality/signer 维度 = Bettor + NWT 各自独立计算后逐值吻合(频道 #pgi9w1 / NWT 22:03Z 两条)

## 0. 前置状态(全部已达成, 执行者逐项核对勾选)

- [x] 步1 三签名站点修复 landed: `d060e872`(第三站点+单源 helper)+ `b862c6e0`(第五站点 voter:696 + 枚举测试 17 项)——NWT diff 审双 GREEN(d2f2f968 / 1c30bb6c)
- [x] 枚举测试全 GREEN(重签前所有裸站点必须修完的 gate): `cd kasia-console && node src/lib/settle-safe-json.test.mjs` → ALL PASS
- [x] locality: jepu1 5 委员(maker-1/broker-2/tester-1/NWT/J2test)全部 local canonical, 单节点手术(Bettor+NWT 双确认)
- [x] selector 全字段规格化+双验证(见 §1)
- [ ] **Owner 签发**(188KAS money-path, Codex 条件 6)
- [ ] **canonical console 已装载 d060e872+b862c6e0**(硬前置: 装载前重签 = 旧代码签 = 白签。committed≠deployed, 今晚已三次实证)

## 1. Selector(Codex 条件 3: 全字段规格化)

判定式(执行时**重新跑**, 不信任何缓存结果):

```sql
SELECT id, event_type, observed_at,
       json_extract(payload,'$.voter_pubkey')  AS signer_pk,
       json_extract(payload,'$.input_index')   AS input_idx
FROM chain_events
WHERE event_type = 'pool_oracle_tx_sig'
  AND payload LIKE '%jepu1%'   -- 执行时替换为含完整 market_id 的 LIKE
ORDER BY id;
```

**硬断言(任一不满足 = ABORT 回频道, 零改动)**:
1. 恰好 **5 行**;
2. `observed_at` 全部 = `2026-06-28 12:48:15`(< c8188d98 落地 19:13 = 全 pre-fix);
3. `input_idx` 全部 = 0;
4. 5 个 `signer_pk` 互异, 且 = jepu1 委员五 pk: `20f208b7…/e72d8e7e…/7b515693…/e92cf4a3…/e8e8d827…`(x-only, 与 pool_committee 对表);
5. 5 个 id 前缀与双算基线一致: `0ff80ef0 / 1472fe85 / 3ed05a7f / 93a3d045 / df334abb`(完整 id 以 Bettor #pgi9w1 与 NWT 22:03Z 两条频道消息为双地面真值)。

## 2. 快照(Codex 条件 4: 不可变审计物, 手术前)

上述 SELECT 加 `payload` 全文输出一次, 存 `docs/2026-07-18-jepu1-surgery-audit.md`(或执行记录附录), 含每行 id/原 event_type/observed_at/signer_pk/payload sha256。软失效方案下物理行保留, 快照仍做(双保险+可核对)。

## 3. 手术(单条事务)

```sql
UPDATE chain_events
SET event_type = 'pool_oracle_tx_sig_superseded'
WHERE id IN (<§1 选出的 5 个完整 id 显式列举>);
-- 断言 changes() == 5, 否则 ROLLBACK
```

## 4. 手术后验证链(逐步, 全可核)

1. §1 SELECT 重跑 → 0 行(陈签名不再可见于收签器/voter 幂等);
2. 下个 settle tick 日志 → `waiting spine sigs: input0=0/5`;
3. 既有 re-broadcast(pool-market-settler.js:2888)按 backoff 自动全员补发 sign_req(等待窗最长 ~12min; 超时未触发再议 one-shot 脚本, 设计稿步3 留了退路);
4. 5 笔新 `pool_oracle_tx_sig`(observed_at=执行日)落库, voter_pubkey 集合 == 委员五 pk;
5. **(Codex 条件 5)settle 广播前**: Bettor 用 canonical safe-json 派生 sighash 独立验每笔新签名——"新行出现"≠成功, 验过才放行 submit;
6. submit → txid 落链 + 188KAS 赢家赔付 + 守恒核对; 若仍拒 = 存在未知第 N 坑, SETTLE_SUBMIT_GIVEUP 既有闸兜底, 停手回频道。

## 5. 回滚

软失效可逆: `UPDATE ... SET event_type='pool_oracle_tx_sig' WHERE id IN (同 5 id)` 即完全还原, 零损失。

## 6. 执行人与分工

- 手术 SQL + 验证 1-4: canonical 侧 operator(J2 或 Bettor 指派), 每步频道回执;
- 验证 5(sighash 独立验): Bettor(已应允 #peri6h);
- J1tn(本机无 canonical 库): 远程盯验证链, 验证 4 后若新签名有异常字节形态, 我做 sighash 域二次分析。
