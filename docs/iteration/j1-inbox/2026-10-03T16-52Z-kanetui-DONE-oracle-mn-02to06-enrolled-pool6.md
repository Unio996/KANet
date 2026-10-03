# KANet-UI 交件：oracle-mn-02~06 enroll + 押金完成，委员池 6 人（账本 (1825) 放行）

作者自报；Bettor 请独立核。未改 env/代码、未重启 console、未设 `is_oracle`。lock_until_daa 全部 566300000。D-021：不含地址/余额。
做法：串行脚本（密钥在进程内读取不打印；任一步失败即停——实际全程零失败）：核有 ≥2 笔已确认 ≥3.05 KAS UTXO → `POST /api/oracle-pool/enroll`（signing_relay_id=该钱包）→ 两段 envelope 公网 accepted → 等 75 s（避开 pendingSpent 60 s 窗口）→ 往返回的 P2SH 转 1.0 KAS → 押金公网 accepted → 核 P2SH 上 1 个 1.0 KAS UTXO。

| 钱包 | envelope 段1 | envelope 段2 | 押金（fee 0.032047） |
|---|---|---|---|
| oracle-mn-02 | b13e9db8eb552e5ca372bb640da8d046b40d7558f1a894ed809cda727b1cc358 | 8ab9d57c7a9519b3752cc6f7581bd37942b7b1646627c7ae965a0e1860ad6224 | 397a464a493af9f043cb13bff2aa43406e7fc1731ace2631277f49d455a7cf37 |
| oracle-mn-03 | acf6aef0693704eb9f54c6cf118645fb13d4ae10423fda118937b83f34dae30e | ba94a8bc3fcb08fdbbdf0e3bf90585bd1ce24232b88dc8b3b71b6a7f5a088818 | 3601eba0d18f3d95c5540d068ebc1fca1d498ea80652f0ead456f4e7c387f8d2 |
| oracle-mn-04 | 94d97765599bde68911dd4ee818cb86abd084530807023fb7983644572bf372c | 8f72a5387fe83913bdfdb8a63b413aded3232159c680db95ffc9024ac8ffb0c7 | 1cf52a578ac76685d6706fbca6fdaeee2760d6a897d6f2b1f896ddd0ef32efa5 |
| oracle-mn-05 | df71980b4a5f4a05cdb3c28c72801a6f48ac55edbe15eb16bd46bc3cbd241a85 | 214f514810ed3a819b2cb6b24b41794b91e01d7c84be9b68b7ec77abe33093e9 | ff8a55c6b8b99b5139b63554a0cf9596553f1ff90bd633394bb2a334947f7652 |
| oracle-mn-06 | 77a2c0c801c46cceffb5c0564310a835bc685f9db9c9703d6aebdd3c2244c295 | a841cee785be5ee805fac369c6af7b155077fbfb39857d0d9f2ad101c63fdcc7 | f40a97738c4aeb00e44207bc51f0b596468e3c7a6b1e40c350cab65a775027b6 |

以上 15 笔 `api.kaspa.org` is_accepted=true；各钱包质押地址上均为 1 个 1.0 KAS UTXO。mn-01 的 txid 见前件（envelope dd17ab72…0810 / dc707d44…2358，押金 c8f63c5b…5d48）。

## 入池核对（只读）
- `oracle_pool_chain_view` 最新快照 16:49:17：snapshot_daa=556258256，**pool_size=6**，6 个叶子均 stake_sompi=100000000、lock_until_daa=566300000。（16:44:17 的上一轮是 5：mn-06 押金 16:44:28 才落链，晚一拍，下一轮 16:49:17 补齐。）
- `GET /api/oracle-pool/state`：total_members=6，active_members=6，total_active_stake_kas="6.00000000"。
- `oracle_stake_enrollments`：6 行，全部 source=chain_envelope、active=1；`chain_events` 里 oracle_stake_enroll 6 条。
- scout（PID 35040）仍存活，mode=rpc；console stderr 无新致命。

## 如实/未做
- `is_oracle` 仍为 0（升 Owner 中）：池里是链上质押成员，但本机这 6 个 relay 还不能做委员签名/投票（见 `bshard-close-voter.js:281,413`、`bettor-prediction-voter.js:88`）。
- 6 把钥匙仍只在 `console.mainnet.db` 加密列 + 两份 post-oracle-wallets 备份；之后钱包余额变化未做新备份。
- 押金锁到 DAA 566300000（≈11.6 天）；续期 cron 阈值 3M，约 7M DAA 后才会动。
- 池里有 maker/broker 公钥时抽样需余量：6 人池抽 5 人委员会时只能排除 1 个（`pool-market-settler-v06.mjs:322-363` 的 excludePks，代码推断）。
