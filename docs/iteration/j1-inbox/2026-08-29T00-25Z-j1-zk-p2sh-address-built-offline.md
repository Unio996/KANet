# J1 → J2/Bettor：ZK 门禁 P2SH 地址**已用生产工具离线造出**（可逐字节复核）

- 时间：2026-08-29 00:25Z
- 性质：**全程离线**。未连节点、未广播、未花钱、未 rebuild、未改 `/d/silverscript`、未碰节点、未推分支。
- 承接 `db7fcd67`（P2SH 构造经上游测试核实）——那份是"看懂了"，这份是"造出来了"。

## 1. 产物

用**上游真实 Groth16 夹具**（vk 424B / proof 128B / 5 个 32B public input）+ **生产在用的 kaspa-wasm ScriptBuilder**：

`
锁定脚本(redeem)  430 字节, 末 6 hex = 0120a6
                  (= push 1 字节 tag 0x20, 再 OpZkPrecompile 0xa6)
P2SH 锁定脚本(spk) aa20 670115195e7c8023dfc64516eea89db41e407cc043f239cc7c1a9aa215a8a810 87
                  (= OP_BLAKE2B + push32 + OP_EQUAL)
解锁脚本(signature) 296 字节, 首 40 hex = 20c07a65145c3cb48b6101962ea607a4dd93c753
合计上链          约 726 字节
`

**地址（testnet-12）**：

`
kaspatest:ppnsz9gete7gqg7lcez3dm4gnk6pusrucpplywwv0sdf4gs44z5pqf9kxarug
`

## 2. 🔴 这个地址**绝对不能打钱**

它用的是**上游公开测试夹具**的 vk，对应的 proof 也是公开的 —— **任何人拿上游测试数据就能把里面的币花走**。
它只是构造演示，用来证明工具链走得通。**真用时必须换成我们自己电路的 vk。** 这条我写在最前面，免得有人手滑。

## 3. 这份证明了什么

1. **整条构造用我们的生产工具（kaspa-wasm）走得通** —— 不需要 silverc，不需要任何新依赖
2. **地址可离线推导** —— 给定 vk 就能算出承诺该电路的 P2SH 地址，无需上链
3. **字节级与上游一致**：
   - 解锁脚本首个被压的是 `input4`（夹具最后一个），**印证 `inputs.iter().rev()` 的倒序实现正确**
   - 锁定脚本末尾 `0120a6` 与 `d541bd61` 规格逐字相符

## 4. 尺寸参考（给排 fee 用）

| 项 | 字节 |
|---|---|
| redeem（vk 424B 为主） | 430 |
| signature（5 inputs + count + proof 128B） | 296 |
| 合计（不含 redeem 二次推入开销） | ≈ 726 |

叠加 `b745ce20` 报的脚本单位成本：Groth16 tag 固定 `Gram(1000×140)`，**再加随 public input 数增长的 vk 反序列化计量**。
⇒ **ZK covenant 的 fee 必须按「字节 + 脚本单位 + public input 数」三项算，不是常数。**

## 5. 下一步（要花钱，归 Owner）

`db7fcd67` §4 那条最小验证路径现在只差最后一跳：**换成我们自己的 vk → 打小额 → 用 signature script 花掉 → 看链上 accept**。
成功即同时实证 `covenants_enabled` 在 TN12 为真（`b745ce20` §5 我列为未实证那条）。
**属钱路 + 动链 ⇒ 归 Owner 批。我没做也不会擅自做。**

## 6. 边界

- **未上链、未广播、未花钱**；未构造过真实 proof（用的是上游夹具）
- 未跑验证引擎 —— 我只造了脚本与地址，**没有证明这条脚本在链上会被 accept**
- 地址推导用 `kaspa-wasm` 的 `addressFromScriptPublicKey(spk, 'testnet-12')`，未与第三方工具交叉验证

---
复核：`scratch/_j1_zk_p2sh_build.mjs` + `scratch/groth-fixture.json`（younio，离线可复跑）。