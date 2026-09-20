# 9-4 隔离 simnet 干净整轮 —— 结果(2026-09-20, J2)

环境: 隔离 simnet(节点 --enable-unsynced-mining, 无 PoW), console 127.0.0.1:3299, relay proto-simnet-2(4×0.99 KAS 干净 UTXO), 主线 b6f744b5(含 pointers 形状修 + A① simnet wallet)。出块人=J2(一次性币基地址, 不付 relay)。

市场 da980ff45fa060a7f63ebf81de520bc604fab376843b581f67f951f8108b9f79, deadline 08:41:06Z, side0/600 + side1/700, winning_side=1(受控 SQL, write-once, 前后读数见 actions.jsonl)。

| 步 | txid | 驱动日志 |
|---|---|---|
| genesis | 6af610907ca98de2db735bff110a51a0e2c96e789057339e10371a3deb21aca3 | proto-driver tick19 genesisLanded=1 |
| 注1 | 79464f616c1bac225650016559419c152655b1cd95a2ae4115c2e53f1c24dd02 | betAppendLanded=1 |
| 注2 | c50959a00af1246444f882365f99586f548306f64ab883615f2e98685b6477ff | betAppendLanded=1 |
| seal | c768cdaecc6a5ca0695951505b09342cd853fbc883947b8b850124549798ec85 | settlement-driver tick1 submitted:1 → tick3 landed:1 |
| close_commit(step=resolve) | 9a0249166ed9516d52e18b9194bbcb30604201038fa07851ace03d90be5ccc65 | tick5–11 gated:1(pmt 闸) → tick12 submitted:1 → tick14 landed:1 |
| convert_to_claim | a888cc23bb023e23a31f42cbccfebb618e395cf715f705ebf2e26bf50cdb22d9 | tick15 submitted:1 → tick17 landed:1 |
| claim_draw | 5a9d13094f34a02526e55d06cd25d9aeb9e602ec151d916c584a49a0c32a3d80 | tick18 submitted:1 → tick20 landed:1 |

终态: markets.status=resolved; 4 条 settlement 意图 landed 且 last_error=NULL; proto_claims 1 行 amount=1300 claim_txid=5a9d1309…3d80; 修复上线(08:51:10Z)后 error 级事件 0 条。

真链暴露(离线全绿): (1) relay wallet 不认 simnet(A①已合); (2) pointers 与 relay 真写入方 prepared_tx_json 形状不一致(见 2026-09-20-j2-batch9-94-pointers-shape/); (3) pmt 闸在短 simnet 链上需多挖推进 PMT(节点 pastMedianTime 窗 2630 样本 > 整条链 ⇒ 中位数 = 整条链历史的中位块; 我在 08:56–09:01 以 200ms/块突发挖 1520 块把 PMT 推过 deadline+30s, 随后回 5s/块)。闸是被真实满足, 不是绕过。

诚实边界: 干净路径(无污染费率向量); resolve 是受控 SQL(9-3 的 /resolve /claim HTTP 未实现); 单赢家(两注同一委员公钥); simnet 无 PoW/无对手方, 不证明主网共识行为之外的事; V1/V2 污染费率向量另起一轮(NWT)。
文件: actions.jsonl(受控动作), console-proto-lines-0911Z.log(console 日志中 proto/relay 行), miner-burst-head-tail.txt, miner-run1-stopped.log。
