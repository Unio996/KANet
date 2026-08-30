# provenance · console 主进程 IBD 期 wasm 线性内存增长 · 只读实验读数（2026-08-30 J2）

> 对象 = `:3200` console pid 16140（8/29 18:56Z 起）· 主稿 `docs/2026-08-30-j2-console-ibd-memory-growth-diagnosis.md` · 全部实验在**独立 node 进程**跑，只读 RPC（`ws://127.0.0.1:17210`，同 `scratch/_step0_gate.mjs`），不连 relay 私钥、不广播、不碰 console。
> 所有脚本 `import 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js'`（= console 用的同一份 kaspa-wasm 1.1.0），`wasm` 列 = `kaspa.__wasm.memory.buffer.byteLength / 2^20`。

## 1. 主进程仪器读数（`heap-sample.pid16140.log` = `logs/console.log` 中全部 `[diag:heap-sample]` 行，187 行，19:07:36Z→00:12:52Z）

| at (Z) | heapUsed | heapTotal | rss | external | **wasmBytes** | utxoFetchCalls |
|---|---|---|---|---|---|---|
| 2026-08-29T19:07:36 | 346 | 433 | 731 | 45 | **40.6** | 11 |
| 2026-08-29T21:00:25 | 81 | — | 531 | 648 | **636.2** | 261 |
| 2026-08-29T23:47:58 | 70 | 191 | 587 | 1879 | **1869.8** | 682 |
| 2026-08-30T00:12:52 | 55 | 65 | 236 | 2066 | **2061.9** | 746 |

派生（`wasm_rate.txt` / `step_vs_lag.txt` / `jumps.txt`）：19:07→23:47 平均 6.59 MB/min（0.39 GB/h）；按间隔内 utxo 调用数分组：0 次 6.33、1–2 次 7.08、≥8 次 6.03 MB/min（无相关）；≥15 MB 台阶 22 个（`jumps.txt`，秒级窗）；台阶窗 lag 告警均 38.6 次 vs 非台阶 5.4。

## 2. `wasm_mem_limits.mjs` — kaspa_bg.wasm memory 段
```
memory[0] flags=0 min=62 pages (4 MB) max=NONE(=4GiB wasm32 cap) shared=false
exports: [ { name: 'memory', kind: 'memory' } ]  imports(memory): []
```

## 3. `wasm_growth_probe.mjs`（faucet 地址 13 entries）
```
== A: 15x new RpcClient->connect->getBlockDagInfo->disconnect | wasm0=3.9   end wasm=4.2
== A: 15x ... ->disconnect->free() | wasm0=4.2                            end wasm=4.4
== B: one client, 15x getUtxosByAddresses(faucet) | wasm0=4.4 entries=13  end wasm=4.5
== D: one client, 15x getBlockDagInfo+getServerInfo | wasm0=4.5           end wasm=4.5
== C: idle persistent connection 150s, sample /15s | wasm0=4.5            +15s..+150s wasm=4.5 (10 samples, flat)
```

## 4. `wasm_obj_cost.mjs`（redeem = 真实 v07 spine_redeem_script_hex，4238 hex = 2119 B）
```
== Address(str)                       A no-free n=2000 dWasm=0.1 | gc | B again n=2000 dWasm=0.0 | C free n=2000 dWasm=0.0
== ScriptBuilder.fromScript(redeem).p2sh+addr  A n=2000 dWasm=4.4 (2.2 KB/obj) | gc → wasm=8.4 | B n=2000 dWasm=0.0 (复用) | C n=2000 dWasm=0.0
== XOnlyPublicKey(hex).toAddress      A n=2000 dWasm=0.0 | B 0.0 | C 0.0
== Transaction(1in sigScript 2.2KB, 2out covenant)  A n=300 dWasm=0.0 | B 0.0 | C 0.0
== serializeToSafeJSON x300           未跑到: "Transaction input is missing UTXO entry"（脚本待补 utxo 条目）
```

## 5. `wasm_walk_probe.mjs`（反向 getBlock walk，沿 verboseData.selectedParentHash）
```
N=20000 includeTransactions=false: dWasm=0.1MB = 3 B/call ; 0.40 ms/call ; after gc second pass 10000 calls: 0 B/call
N=5000  includeTransactions=true : dWasm=0.4MB = 79 B/call ; 0.40 ms/call ; after gc second pass 5000 calls: 0 B/call
```

## 6. `wasm_conc_probe.mjs`（10 个 relay 地址并发，含千级碎片 UTXO 的地址）
```
round 10: wasm=36.0 (+32.1) | round 20: 43.9 (+39.9) | round 30: 43.9 (+39.9)
concurrent utxo: 300 calls dWasm=39.9MB ; concurrent info x120: dWasm=0.0MB
```

## 7. `wasm_capture_replica.mjs`（逐字复现 `captureSideLockDaa` IBD 路径：new RpcClient → connect → sink → 10k getBlock(tx) → disconnect）
```
iter 1: calls=10000 wasm=4.3 (+0.4) heap=18 4.1s
iter 2..8: +0.0 / +0.1 / +0.0 / +0.0 / +0.0 / +0.1 / +0.0  → wasm=4.4 ; after manual gc wasm=4.4
```

## 8. `wasm_capture_replica_ballast.mjs`（同上 + 150 万常驻 JS 对象 ≈388 MB 堆 + `--max-old-space-size=4096` + 每步留 2000 个 block 垃圾）
```
ballast=1500000 objs heap=388MB start wasm=3.9
iter 1: +0.4 (heap 310) | iter 2..8: +0.0/+0.1/+0.0/+0.0/+0.0/+0.1/+0.0 (heap 110–303 波动) → wasm=4.4 ; after gc 4.4
```

## 9. 时序对齐（`preprune.txt` = 29 个 `[preprune-capture-worker] tick` 结束行及由相邻 diag 行推得的时刻；`zk.txt` = 25 个 `[zk-autonomy]` tick 行）
- 22 个台阶窗起点距前一个 preprune tick 结束行：+2.0 / +1.2 / +1.0 / +0.7 / +2.6 / +1.1 / +1.0 / +3.4 / +0.3 / +1.0 / 0 / +0.5 / +0.8 / +0.7 / 0 / +0.7 / +1.0 / +0.5 / 0 / +2.3 min（首个 18:56 台阶 = boot 期）。
- `[zk-autonomy]` 行与最近台阶偏移 −442…+902 s，仅 2/25 在窗内 ⇒ 不对齐。

## 10. 现场其它读数（CIM / DB 只读）
- 00:12:58Z：console main Private 2332 MB / WS 236；relay 子 35 个 Private 合计 4819 MB（23:50Z 4780）；commit 60.6 GB；主进程 → :17210 = 4 ESTABLISHED（50223 = settle-daemon 单例；56486/56487/56489 同批）+ 1 CloseWait。
- console.db：`pool_bettor_sides.side_lock_daa IS NULL` 33,149 条 / 1,575 盘，`deadline_daa` 28,377,739–840,742,023；`spc_daa_index_coverage` 8,187 段 56,983,539–80,896,296。
- `[rpc-health] local node TCP ok but data check failed: timeout` × 3（L2623/2625/2627）。

复核：`cd docs/provenance/2026-08-30-console-wasm-growth && sha256sum -c MANIFEST.sha256`；重跑任一脚本需本机 kaspad `:17210`（只读）。
