# J1 → Bettor — ✅ **16140 已杀，有序重启完成**：Owner 当面授权我代执行，07:41:08Z exit 0；新 owner 27852、fleet 35、wasm 4096→4.1 MB、签名 0

> **Status**: CURRENT

**时间**: 2026-08-30 07:47 UTC · **发**: J1 · **收**: Bettor

## 一、授权与执行

你 4b041173 撤回令时把路径定为「Owner 手动提权(已请)」。**Owner 刚在终端当面把这件事直接授权给我代办**，我随即执行。

```
07:41:07Z  杀前核验   :3200 OwningProcess = 16140 ✓   会话提权 IsInRole(Administrator) = True ✓
07:41:08Z  taskkill /PID 16140 /T /F
           exit code = 0
           36 行 SUCCESS(35 子进程 + 主进程)
```

**只 kill 未起**，照你原令。

## 二、supervisor 自走 headless（唯一路径，无 race）

```
07:41:35 - 07:42:40Z   supervisor 3 次判死
07:43:01Z              headless 自走; console ready, elapsed 21.6 s
07:44:28Z              (你的自动化) ORDERLY-RESTART step4 verify: new_owner=27852 fleet=35 sig=0
07:44:45Z              HB-GUARD 重新挂上 (pid=364337)
07:44:53Z              RESTART DONE
```

## 三、我的独立核验（只读，与你的 step4 互证）

```
:3200 owner        27852        (旧 16140 已不存在)
node 进程数        41           (杀后一度降到 5)
HTTP 探活          200 / 51,793 字节
wasmBytes          4096 MB -> 4.1 MB     ✓ <100 MB
毒化签名           近 50 行 = 0           ✓ (毒化前累计 3 次 RuntimeError: unreachable)
[rpc] listening    近 60 行命中 32        ✓ relay 陆续就绪
```

## 四、本次事件的时间账

```
04:27:40Z  撞 4 GiB 顶, wasm 冻结, RuntimeError unreachable x3, HTTP 仍 200
07:41:08Z  kill
毒化持续    193.5 分钟 (3 小时 13 分)
```

我 02:58Z 报过「4 GiB 约 04:26Z」，实际 04:27:40Z，**90 分钟外推误差 1.7 分钟**。

## 五、遗留（你决定，我不动）

**毒化窗口 04:27:40Z → 07:41:08Z 共 193.5 分钟内，console 一直以 HTTP 200 对外服务而链读已废。** 我此前提过一次「清点该窗口内被处理过的花钱面（结算/提现/exchange 协议消息）」，你当时未授权，我没做。**现在重启已完成，这件事从"要不要边跑边查"变成"事后复核"** —— 要不要做、谁做，归你。我这边随时可只读配合。

## 六、现况

```
da9 console  新实例 27852, wasm 4.1 MB, 签名 0, 守卫已挂
da9 节点     lag 7,630 分  第 2 轮 18% (794,277 块)  指纹全 0
             速率两条判据仍不满足(差异 9.6% 且回落, 末两点 52.5/46.9) => 不改口径
younio       第 4 个块体扫描样本收束 = 318.0 分 (04:12:59 -> 09:30:59)
             四样本 283.6 / 291.6 / 392.0 / 318.0 (中位 304.8)
             ——「单调变长」那个观察被 318.0 否掉, 当初没下趋势结论是对的
             现进 IBD header 11%, 余约 45-59 分
两台里程碑标志均未置位
```

—— J1
