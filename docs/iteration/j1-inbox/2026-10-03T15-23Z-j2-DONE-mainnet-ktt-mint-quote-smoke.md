# J2 交件（完整）：主网小额实测 KTT 指定数量铸币 + 商家建报价页（(1804)(1805)(1806)）

报价页部分见同目录 `2026-10-03T12-58Z-j2-PARTIAL-…`（通过，实花 0）。本件补 KTT 三笔。全程只走控制台现成接口（POST /api/ktt/mint、/api/ktt/transfer），没碰私钥文件、没改 env/代码、没重启。收款方只用我们自己的 relay 公钥。

## 前置
- Owner 自转合并 txid `732dc5ab1f41c43d50033c1ad6b27a744d572767162403473f5bfb7d90aafb40`：我自己公网核 is_accepted=true，输出 1.25000000 + 0.31268386 KAS；`api.kaspa.org/addresses/<铸币 relay 0044cfbd>/utxos` 现为这两个 UTXO，≥1.2 KAS 的单个 UTXO 已具备。

## 三笔（KTT 数量 1,000,003；owner_scheme=0 pubkey）
| # | 动作 | txid | api.kaspa.org is_accepted | 输出 | 手续费 |
|---|---|---|---|---|---|
| 1 | 铸币 → owner=0044cfbd 自己公钥 | `a5a6640b9ed775163ee8ea16577f3ceb0a9d3c21d8b9436a1c9969f1cf4d51fe` | true | 代币 UTXO 70,000,000 sompi（0.7 KAS 锁量）+ 找零 47,394,380 | 7,605,620 |
| 2 | 自转（同公钥 → 同公钥，整笔） | `764152761d160cd484d2ca6b69406f8f713b15c520664ad2330965b1455f4b7c` | true | 70,000,000 + 找零 40,894,380 | 6,500,000 |
| 3 | 整笔转给另一个我们自己的 relay（J2 relay 公钥 `fd6d9fd4…4000`） | `171f118e2735f175b010a291e65a35cc56c68227f98ed799680cf6615aa0530c` | true | 70,000,000 + 找零 34,394,380 | 6,500,000 |

## 数量核对（不是锁定 sompi）
- 控制台 `GET /api/ktt/holdings?owner_hex=<J2 公钥>`：1 条未花记录，`amount_sompi="1000003"`，txid 即第 3 笔。
- `GET /api/portfolio/unified`：J2 的 `ktt.unspent[0].amount_sompi="1000003"`（不是 70000000）；`spentCount` 对应该 relay 视角。
- 未用浏览器渲染钱包页/portfolio 页截图，数量以接口原文为准。
- 账本侧：mint 记录与两次转账链（ledger id `695af8f4…` → `b2c9780b…` → `cd6f08e2…`）一致，前两条已标 spent。

## 实花合计（公网核）
铸币 relay 0044cfbd 余额 156,268,386 → 65,662,766 sompi，净减 **90,605,620 sompi = 0.906 KAS**（= 手续费 7,605,620 + 6,500,000×2 = 20,605,620，加随代币锁定的 70,000,000，该 0.7 KAS 现锁在第 3 笔的代币 UTXO 里，随代币转移、不可取回）。硬顶 ≤3 KAS，单笔 ≤2 KAS，均未触及。无异常，无重试。
