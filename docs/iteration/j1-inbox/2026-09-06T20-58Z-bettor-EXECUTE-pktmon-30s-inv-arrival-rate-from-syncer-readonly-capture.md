# 执行单（只读抓包·提权）：pktmon 抓 30 s，数 136.243.93.17 → 本机的小帧到达率（D-c 判别 A/B）
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T20:58Z · 权威 ledger (947)(948) · NWT 21:00Z 建议 §3(i)

## 为什么
kaspad 20:18:44Z IBD 完成后转中继模式，恒 0.75 bps（45 块/min），链 10 bps ⇒ sink 每秒多落后 0.93 s，isSynced 20:29Z 起 false 且不会自己回来。
两种解释：**A** 对端 inv 按链速（≈10/s）到达、我方 inv 队列（2560）满后 Drop、顺序耗尽后 orphan 触发 IBD；**B** 对端本就只发 5 块/6.6 s 的 inv，队列不满、永不重开 IBD。
我方 getMetrics 只有字节级计数（团间 ≈102 B/s），分不出帧数。**pktmon 数帧能直接分**：A ⇒ 来自 136.243.93.17 的 ≤120 B 入站帧 ≈10/s 持续；B ⇒ 每 ≈6.6 s 一小撮。

## 做什么（管理员 PowerShell·纯抓包·不重启不改配置·30 s）
```powershell
pktmon filter remove
pktmon filter add kas -i 136.243.93.17
pktmon start -c --comp nics --pkt-size 128 -f D:\kanet-tn12\scratch\pktmon-syncer.etl
Start-Sleep 30
pktmon stop
pktmon format D:\kanet-tn12\scratch\pktmon-syncer.etl -o D:\kanet-tn12\scratch\pktmon-syncer.txt
pktmon filter remove
# 统计：每秒入站帧数（只看 136.243.93.17 → 本机），以及长度 ≤120 B 的小帧每秒数
$lines = Get-Content D:\kanet-tn12\scratch\pktmon-syncer.txt | Where-Object { $_ -match '136\.243\.93\.17\.16311 > ' -or $_ -match '136\.243\.93\.17:16311 > ' }
"inbound_frames_total=$($lines.Count)"
$lines | ForEach-Object { if ($_ -match '^\s*(\d{2}:\d{2}:\d{2})') { $Matches[1] } } | Group-Object | Sort-Object Name | ForEach-Object { "$($_.Name) frames=$($_.Count)" }
$small = $lines | Where-Object { $_ -match 'length (\d+)' -and [int]$Matches[1] -le 120 }
"small_frames_le120B_total=$($small.Count)"
$small | ForEach-Object { if ($_ -match '^\s*(\d{2}:\d{2}:\d{2})') { $Matches[1] } } | Group-Object | Sort-Object Name | ForEach-Object { "$($_.Name) small=$($_.Count)" }
```
（`pktmon format` 的文本行形若与上面正则不合，把 `pktmon-syncer.txt` 前 20 行原样贴回即可，我自己数。）

## 贴回收件箱
`inbound_frames_total` / 每秒帧数序列 / `small_frames_le120B_total` / 每秒小帧序列 + 抓包起止 UTC 时刻（`(Get-Date).ToUniversalTime()`）。
**判读**：每秒小帧 ≈8–12 持续 ⇒ A；每 6–7 s 一簇（其余秒 0–2）⇒ B。

## 不做
不重启 kaspad（NWT 的 §3(ii) debug 日志重启方案先不用）；不 ban/unban/addPeer；不动 console 40064；llama 保持停。
younio 节点你之前说明内存原因没跑着 —— NWT 的"加第二个 peer 判别"我知道你手上没有，不派。
