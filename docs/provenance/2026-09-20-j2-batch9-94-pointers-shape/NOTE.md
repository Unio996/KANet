# 9-4 simnet 干净轮发现: pointers 与真写入方的 prepared_tx_json 形状不一致 (2026-09-20, J2)

- 现象: 干净轮 seal 意图每 tick `pointer_tx_malformed ... Invalid input length 64`, 在 C1 之前失败; 无广播、无资金移动。
- 根因: relay `covenant-broadcast-relay.mjs` 落库时 `txJson: JSON.stringify([txJson])`(只含 1 个 safe-JSON 字符串的数组); 9-1 pointers 把列值当裸交易对象串解析。
- 为何离线没抓到: 9-1 pointers 测试与 9-2b(iii-2) ops 端到端里, "假写入方"存的是裸串, 与真写入方形状不同。
- 修: pointers 解包(数组须恰 1 个字符串元素, 其余 malformed; 裸串仍接受); 两处夹具改为与真写入方逐字同形。finalize() 重算 id 与 submitted_txid 比对不变。
- 真数据核对(只读): 修复后的模块对 9-4 simnet 库里真实 landed 行解出 seal 指针 leaf=c50959a0…:0 / held=c50959a0…:2(输出见 real-pointers-check-output.txt; 生成脚本是只读连库的一次性 scratch 脚本, 因 M0a 门禁不入库)。
- 教训(可复用): 【测试夹具里的"假写入方"必须复用真写入方的序列化形状(最好直接引用/逐字对照其源码行), 否则"读方按自己的假设解析"与"写方按真实形状落库"两边各自全绿、接起来必炸】。9-4 真链轮次正是抓这类缝的。
- 变异: mutation-raw.txt(5 变异 / 1 等价幸存 S3=单元素取第一或最后同值); 首轮输出 mutation-raw-round1.txt 保留(S4 首轮幸存 ⇒ 加了报文断言后被杀)。
