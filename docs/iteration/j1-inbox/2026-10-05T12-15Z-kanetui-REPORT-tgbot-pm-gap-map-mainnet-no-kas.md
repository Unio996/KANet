# KANet-UI → Bettor: what it takes to put the prediction market on @KANET_Broker_bot (read-only survey, mainnet no-KAS)

> **Status**: CURRENT (survey only; no code / env / bot change made). Date 2026-10-05. Author KANet-UI.
> Sources: `tg-bot/*.mjs`, `docs/DECISIONS.md` D-023/D-024, `kasia-console/src/api/pool.js`, `mainnet-no-kas-stake-gate.mjs`, `kanet.mainnet.env` (key names only).
> Method: a read-only sweep by a subagent, then I spot-checked the load-bearing claims myself (register-v07 body, tg-wallet 503 guard, readonly shell, `_state.json` files). Items marked (unverified) were not checked.

## 0. Four facts that change the picture

1. **The bot already has a read-only mainnet shell** (`tg-bot/readonly-shell.mjs`, `readonly-handlers.mjs`, registered in `bot.mjs`). It activates only when `KASPA_NETWORK=mainnet` (default is testnet-12). It hides `/wallet /send /faucet /swap /broker_apply`, lists markets from **`GET /api/proto-markets`** (the proto-v0 namespace, not pool), and **has no betting**. The legacy bet code sits underneath it, unreachable on mainnet.
2. **Only one bet route is open on mainnet:** the one-step `POST /api/pool/market/:id/bettor/register-v07` (gateway-sponsored, REOPENED id S1). The bot uses `…/register-v07/prep` + `/confirm`, which return 403 on mainnet.
3. **The bot's money flow does not exist on mainnet.** It asks for a KAS amount, then has the user (or a custodial wallet) pay KAS to a `side_p2sh`. Mainnet takes no KAS from the user; the gateway pays.
4. **Custodial wallets are off on mainnet:** `tg-wallet.js` hard-codes `NETWORK='testnet-12'` and returns 503 otherwise (CR-2). The bot never needs one for no-KAS betting anyway.

## 1. Flow by flow

### 1.1 List markets
- Today: shell → `/api/proto-markets` (`console-api.mjs`); legacy → `/api/pool/markets`, `/markets/trending`, `/markets/available`, `/market/:id`. GETs are not gated.
- Mainnet reality: the bettable markets are pool v0.7 `zk_native` rows (what the console UI now shows). `proto-markets` is a different table and id space.
- Code change: pick the source (recommend `/api/pool/markets`, filtered to `protocol_version==='v0.7' && resolution_rule_spec.zk_native===true && protocol_status==='pending_bettors'` for the "can bet" list). Drop the maker-stake display in `prediction-menu.mjs` (`maker_stake_kas` is 0 in no-KAS mode) and relabel pool totals as chips.

### 1.2 Bet
- Today (`prediction-menu.mjs`): asks a KAS amount (`MIN_STAKE_KAS=1.0`), calls `poolRegisterPrep` → user pays KAS → `poolRegisterConfirm`; `pollPendingBets` polls every 3s.
- Mainnet replacement: `POST /api/pool/market/:id/bettor/register-v07` with `{bettor_relay_id | bettor_pk, direction (0=YES,1=NO), stake_ktt}`. `stake_ktt` = integer in 1e-8 chip units, minimum 100000000 (= 1 chip), `stake_kas` is not read. Market must be v0.7, zk_native, no spine, `pending_bettors`; bettor must not be oracle/maker. Returns `{ok, logical_market_id, bettor_pk, no_kas_stake:true, stake_ktt}`.
- Code change: add `poolRegisterV07()` in `console-api.mjs`; in `prediction-menu.mjs` replace the amount prompt/validation with integer chips (×1e8 → `stake_ktt`), delete the prep/confirm/pay/auto-pay/pending branch on mainnet (no `pendingPayments`, no `pollPendingBets`); re-route `startBet` in `bot.mjs`; replace the shell's `ro_detail_no_bet`.
- **Identity decision needed (my inference):** `bettor_relay_id` must be a `relay_nodes` row with an address (one relay per Telegram user: no provisioning path exists). `bettor_pk` is accepted by the route and is not network-gated, but the code comment calls it a "fresh keypair, cross-node fixture", and **nothing proves the Telegram user owns that pk**: `/link` binds an address without proof (unverified). Bettor/NWT should rule whether mainnet allows `bettor_pk` from a linked address, and who is liable if someone links another person's address.

### 1.3 Wallet / bind
- Keep the shell's mainnet `/link` (validates `kaspa:` prefix). Keep `/wallet /send /faucet /swap` hidden. No custodial wallet, no faucet (chips are not KAS).
- Payout identity: positions are keyed by pk derived from the linked address (`my-positions` derives it the same way), so claims land on the address the user linked. Prerequisite: the user's `/link` must be the address they control.

### 1.4 My positions (`/mybets`, `/record`)
- Today: `GET /api/pool/my-positions?linked_addr=`; shell has them disabled (`ro_mybets_unavailable`), with a reason ("mainnet markets don't record who placed a bet") that is now false for zk_native pool markets.
- Mainnet route is ungated. New fields: `logical_market_id`, `zk_native`, `claims_landed`, `pool_known`, `actual_payout_units`, `payout_pending_units`, `actual_payout_kas` (**already chips**, units/1e8; likewise `stake_kas` = chips despite the name).
- Code change: re-enable on mainnet; label numbers as chips; group by `logical_market_id` (the shard `market_id` is not the market users see); show won-but-pending as "待领" and unknown pool as "金额待定", never as a loss. Same wording the console UI uses (see 7621ce7b/445dd841).

### 1.5 Settlement notifications
- Today: `pollSettleResults` (5 min) fires only when `p.settle_txid || p.refund_txid`; dedup `seen_settled` keyed by shard `market_id`.
- Gap (unverified against a live position): zk_native markets resolve via `zk_continuation.attestedWinner` + claim ticks and do not write `settle_txid`/`settle_evidence`, so the poller would never fire. Change the trigger to `did_win` non-null (win/lose), "已到账" when `actual_payout_kas != null`, "待领" when `payout_pending_units>0`; dedup per `logical_market_id`. Review `notify_settle`/`notify_tx` copy too.

## 2. Broker identity / config (broker=UNSET today)
- Missing from `kanet.mainnet.env`: no `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `BROKER_RELAY_ID` (its comment says sharing one bot identity is "待定"). DB keys written via Settings: `tg_bot_broker_relay_id`, `tg_bot_token`, `tg_bot_username`, `tg_bot_enabled`.
- To set: token + username (D-023: reuse the existing identity); `KASPA_NETWORK=mainnet` in the **bot's** environment (default is testnet-12, which would run the legacy testnet behaviour); `CONSOLE_URL` → `:3202` (default `:3200` is retired); `INGEST_SECRET`; a mainnet broker relay id.
- For no-KAS betting the broker is not needed to place a bet (the gateway is `market.maker_relay_id`, currently pm-settler); the broker only filters the list and receives fee DMs. Unfiltered list works with broker unset.
- `KANET_TESTNET_NO_LIMITS` must stay out of the mainnet env (D-023 §5).

## 3. `_state.json` cleanup
- `tg-bot/_state.json` (255 B, 2026-09-20) already holds only: `sessions=[]`, `pendingPayments=[]`, `linkedAddrs=[]`, `userLangs` (9 pairs), `brokerFeeTs=0`. The D-023 cleanup is therefore **already done**; the shell's `pruneForReadonlyShell` also re-prunes non-`kaspa:` links and sessions at start.
- Do not restore `_state.json.pre-mainnet-20260920` (371 KB, TN12 state) or `.bak-armwindow-20260723`. Bot-side `data/console.db` was not inspected.

## 4. User-facing copy that needs Owner approval (`tg-bot/i18n.mjs`, zh ≈ L425–860, en ≈ L11–417)
- Start/help: `start_commands` ("/faucet 领币"), `help_faucet` ("领测试 KAS"), `help_disclaimer` ("testnet-only … 不运营主网"), `help_send`, `start_btn_faucet` ("💧 领水").
- Bet flow, all in KAS: `bet_amount_prompt` ("最低 {min} KAS"), `bet_amount_min`, `bet_amount_no_link` ("/link <你的 kaspatest 地址>"), `bet_confirm_*`, `bet_autopay_*`, `bet_manual_pay_*` ("{sompi} sompi", "≥1 KAS"), `bet_still_pending`, `bet_detail_deadline_count` ("maker stake {stake} KAS"), `bet_detail_odds`, `bet_detail_low_pool` ("总池 < 100 KAS").
- Faucet: `faucet_*`.
- Notifications: `poll_registered`, `poll_win` ("应到账 {payout} KAS"), `poll_lose`, `poll_neutral`, `notify_settle` ("KAS 已到你 /link 地址").
- My bets/record: `mybets_*` ("投入总/返回总/净 … KAS"), `record_net`, `record_footer` ("testnet KAS only"), `champions_footer`, `earnings_testnet_note`, `fee_dm_testnet_note` ("仅测试币·非真钱").
- Shell copy that is still **unapproved** per its own code comments: `ro_start_notice`, `ro_help`, `ro_link_ok` ("betting from Telegram isn't available yet"), `ro_list_footer`, `ro_detail_no_bet`, `ro_mybets_unavailable`. `ro_detail_min_bet` already says "zero-value test token" and may be reusable.
- D-023 §4: first-contact copy must say the stake is a zero-value test token. Owner approves all of the above (铁律 0: user-facing text).

## 5. Risks / unknowns
- `bettor_pk` on mainnet (see 1.2): ownership/consent unproven.
- Settlement poller on zk_native (see 1.5): unverified against a real position; test it against a simnet position before trusting it.
- Two data sources (`proto-markets` vs `pool_markets`): the bot must show one; ids are not interchangeable.
- `register-v07` returns 503 if the market's `maker_relay_id` relay is not alive.
- Capacity: `ZK_MAX_LIVE_MARKETS` (3 now), per-market leaf cap `MARKET_MAX_LEAVES_G3`.
- Unit confusion: API fields named `*_kas` carry chips; that is the likeliest bug source.
- Existing bot tests (`readonly-shell.test.mjs` etc.) assert today's read-only behaviour and will need updating.
- D-024's wiring pause: I found no decision that approves a bot bet path; the "bot 接 proto v0 API" condition is moot (mainnet runs pool v0.7), but reopening needs a ledger entry.
