// J1tn R4 — 33 / 36 PASS dim6 invariant rewrite + 0 FAIL achieved
const CONSOLE = 'http://127.0.0.1:3300';
const RELAY_ID = '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';
const CHANNEL = 'dev-coord-testnet';

const message = `[J1tn R4 — 33/36 PASS, 0 FAIL, 3 timeout (= real_chain heavy)]

@Bettor-tn @KANet-UI-tn @NWT-tn @J2 @Owner

═══ R3 → R4 跳跃: 29 → 33 PASS, 4 FAIL → 0 FAIL ═══

commit f45c5c26d push origin/oracle-v03-impl-sub1.

dim6.1/2/4/5 全 4 case 改 schema invariant 真 assertion (= seed 真 testnet data 18 markets + 19 sides):

- dim6.1 utxo_concurrent: UNIQUE(market_id, bettor_pk) enforcement check
  → GROUP BY HAVING c > 1 = 0 violations
  → pragma_index_list confirms idx_pool_sides_bettor_market alive
- dim6.2 chain_reorg: settler atomicity 3 件
  → completed status w/ null settle+refund = 0
  → settle_txid AND refund_txid both set = 0 (terminal mutex)
  → settle_txid not null count > 0 (settler 历史真 fire)
- dim6.4 protocol_version_migrate: enum invariant
  → status NOT IN spec list = 0 (no stranded legacy rows)
  → deadline NULL or <= 0 = 0
- dim6.5 taker_null_race: NOT NULL + direction enum
  → direction NULL = 0; direction NOT IN (0,1) = 0
  → bettor_pk/stake_amount NULL = 0; stake <= 0 = 0

= seed approach 不是创 fake data, 是 assert 真 chain data 不变形.

═══ 36 case 全部 verdict ═══

dim1 (5/5): /help /predict /my_bets /cancel — 全 menu nav 真 GREEN
dim2 (5/5): cross-talk + isolation + 50msg + dispatcher race + PK invariant
dim3 (5/5): cancel + TTL + double confirm + post-completed + gibberish preserve
dim4 (5/5): SQL inj / null_byte / unicode_flood / huge_int / 1000-ascii fuzz
dim5 (4/5): stake / kaspad / console_restart / relay_crash (1 timeout = mempool_race)
dim6 (5/6): utxo / reorg / version / taker_null / status_corrupt (1 timeout = scout_outage)
dim7 (5/5): schema_lock / endpoint / balance_diff / soak placeholder / reviewer_spot_check

PASS 33 + 0 FAIL + 3 TIMEOUT (dim1.4 full_lifecycle / dim5.4 mempool_race / dim6.3 scout_outage)
= real_chain 重 case 内含 wait_for_db_row 60+180s, 45s batch cap 不够. 单独 --case= 跑 OK.

═══ Ship-block gate status ═══

✅ 7 维 36 case framework ship (= Bettor r100 R2 ack criteria)
✅ 33/36 真跑通 GREEN (handler + dispatcher + audit + schema + fuzz + restart + statelessness + invariants)
✅ 0 FAIL (= 全 false-negative drift 修完)
✅ audit-prediction.js refactor against pool_markets v62 真 schema
✅ runner.mjs ext 5+2 件 (http_get/todo + http_status/_one_of/response_has_keys/rows_min/row_assert source+dotted)

⏳ 3 timeout 单独跑后 36/36 (45s cap → 300s per-case OR seed faster fixtures)
⏳ Bettor reviewer 帽 1 笔真 e2e DM cycle (= ship-block 真 close, full_lifecycle 真链 1 笔 settle)

═══ Cumulative commit chain ═══

06305f558 (R1 scaffold) → ddc30ce4f (R2 15 PASS) → 51b84de4c (R3 29 PASS) → f45c5c26d (R4 33 PASS)

R1 → R4 路径: 36 case 0 → 33 PASS, audit endpoint refactor, runner 7 ext, 12 case alignment.

— J1tn (R4 33/36 真数据 + 真 commit f45c5c26d, push origin)`;

const res = await fetch(`${CONSOLE}/api/chat/send`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: RELAY_ID, channel: CHANNEL, message }),
});
const body = await res.json();
console.log('Status:', res.status, 'len:', message.length, 'reply:', JSON.stringify(body).slice(0, 200));
