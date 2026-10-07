# 交付步 4 主网小额实测（账本1882）— 结果

临时实例（端口 3299，新 DB/key/relay 钱包，只共用主网 kaspad wRPC）。全部为自有地址 + 凭据派生地址，合计 ≤2 KAS。机密只在 docs-private。

| 步 | txid | 说明 |
|---|---|---|
| 转入临时钱包（Bettor） | 758987563a7fc0e4c7b47d1e1a896c310813ee3ab927b1182d2dc620a2bd690b | 1.5 KAS |
| A 付款 | 7291e7f165604818c94db3c89645fb20d85675c6de7d83383acf4ea6ef0823cd | 0.614 → 订单地址 |
| A split | a0ef06cb030aa3697824e1a57c178f3352be16a755db97e11028498d4ee103cd | stress-user-07 0.48 / stress-user-08 0.12 / 费 0.014 |
| A 信箱 | 882a84319dff6a5d47e5a0ad0314efed98dba4b66c3be511b16cdb344a014e3f | 面值 0.2 |
| A 清扫信箱→临时钱包 | 3de22fcd2b69497644f2372a74d1e09b96a08d0fddf9e8b1c8f4ed42418fd8da | 0.198376 |
| B 付款 | ae2dad15ca3c4e7c34d007f2f7d2e10ad7a39d6781aa29a6cfd74c9737c6ba15 | 0.614 → 订单地址 |
| B 到期退款（零签名） | 491e30fe865c5c8ab4bad91c0b5f971d3418c8b9ecbce642184ce2ab0a479931 | → 退款 P2PK 0.603 |
| B 清扫退款→临时钱包 | 35245c021486f4bb95e7d5b2a03e62f784f07c0c6e3b04015c3c7067de636434 | 0.601376 |
| 回款 1（转 Bettor） | 06c0a5d63a21a275b5660bb85d1367876e4f1672341f3d4e5612dc1d091730a9 | 0.30（relay transfer） |
| 回款 2（清扫） | a0de480f256bd6f9b3c2619248b5958b6341d69ed777d6c3c210be0b2bb7195a | 0.17138 |
| 回款 3（清扫） | 0176c3c05426cafaf5da6b4bd3f4f1a5879ce2837333532c2c58a664d826fcae | 0.267716 |

## 发现（须记入后续）
1. relay `transfer` 无法"全部转出"：找零为小额时报 `Storage mass exceeds maximum`（本地 Generator 上限更严）。收尾须用 `sweepP2pk`（空输出、单输出无找零）。商家运营如需清空钱包，用清扫而不是 transfer。
2. 主网 PMT（past median time）也落后墙钟约 5 分钟：B 单 deadline=+150s，约 5 分钟后才可退款。买家页文案应提示"到期后可能需等几分钟"。
3. 净成本：Bettor 转入 1.5 KAS，回款合计 1.5 − 0.6（stress-user 07/08 收款，属自有地址）− 0.014（split 费）− 约 0.2 信箱面值被清扫回钱包后计入 − 各笔网络费，详见逐笔表。
