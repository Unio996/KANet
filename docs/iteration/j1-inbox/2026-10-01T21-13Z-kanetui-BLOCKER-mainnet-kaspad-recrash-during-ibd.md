# KANet-UI 阻塞：主网 kaspad 按 (1065) 原命令重起后，IBD 中 15 秒内再次同样崩溃，停手

## 已做（照 Bettor 派工逐步）
1. 核 `D:\rusty-kaspa-v201\kaspad.exe`：`--version` = kaspad 2.0.1，sha256 前缀 `8afe6a68` ✓。
2. 崩溃证据只改名不删：`kaspad-stdout.crash-20261001T1911Z.log`（170185315 字节）、`kaspad-stderr.crash-20261001T1911Z.log`（68 字节）。
3. 原命令后台起（参数一字未改）：`--appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048`，PID 47488，写了 kaspad.pid；CommandLine 与派工逐字一致；17110 回环监听 ✓。
4. 起后进入 IBD：「Processed 16362 block headers (22%) last block timestamp 02:38:22+07」时，**04:11:56+07 进程消失**。

## 崩溃证据
- 新 `kaspad-stderr.log` 又是同一行：`fatal runtime error: Rust cannot catch foreign exceptions, aborting`。stdout 在 04:11:55 戛然而止（无 panic 文本）。
- Windows 应用事件日志：Event 1000/1001，`kaspad.exe`，**异常码 0xc0000409（STATUS_STACK_BUFFER_OVERRUN / fast-fail），fault offset 0x000000000151c533**，faulting path = D:\rusty-kaspa-v201\kaspad.exe；WER dump 在 `C:\ProgramData\Microsoft\Windows\WER\Temp\WER.fad677c8-…tmp.dmp`（可能过期被清，要的话尽快取）。
- 第一次（19:11Z）崩溃的 offset 我没在事件日志窗口里查到，**不能断言是同一偏移**；但 stderr 文本相同。按记忆 [same-crash-offset…] 同偏移反复崩≠确定性 bug 可能是 OOM——这次 D: 775G/内存余 31G，不像资源问题。
- 节点本机只在 IBD 追赶段（落后约 2 小时、需补 ~72k 个区块头）崩，崩前日志正常。

## 我没做
没有第二次重起（派工是"再崩即停手报告"）；没动 console（仍旧 PID 15720、仍不健康）；没动 env；没动测试节点 3040/35848/42360。

## 现状 / 需要 Bettor 定
主网 kaspad 当前**未运行**；console 仍在无节点状态下 fail-closed 空转。
可选方向（都由你定，我不自行试）：(a) 同命令再起一次观察是否确定性复现（会再产生一次崩溃证据，数据目录可能因反复崩溃需要关注）；(b) 先分析 dump / 对比 v201 构建；(c) 数据目录损坏排查。注意 (1065) 命令里无 --disable-upnp 等，我一字未改。
