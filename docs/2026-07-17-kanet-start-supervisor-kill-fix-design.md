# kanet-start.sh 误杀 console-supervisor 修复设计稿(2026-07-17)

> **Status**: CURRENT(设计稿·待 NWT 红队;红队过后落码,落码前不动代码)
> **作者**: KANet-UI · 依据: Bettor 派工(#opgywp.2/#opl... 系列, "根治级发现"+"紧迫性高别当观察卡攒")

## 根因(读码坐实, 非猜测)

`kanet-start.sh` 停止阶段(第 54-65 行):

```bash
for pidfile in "$PID_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  name=$(basename "$pidfile" .pid)
  if kill -0 "$pid" 2>/dev/null; then
    powershell -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue" 2>/dev/null \
      || kill "$pid" 2>/dev/null
    log "  停止 $name (PID $pid)"
    STOPPED=$((STOPPED+1))
  fi
  rm -f "$pidfile"
done
```

无差别遍历 `$PID_DIR`(`logs/pids/`)下**每一个** `*.pid` 文件并强杀对应进程。
`scripts/kanet-console-supervisor.sh:25` 的 `PID_FILE="$KANET_ROOT/logs/pids/console-supervisor.pid"`
落在同一个目录, 因此每次 `kanet-start.sh` 执行都会把 supervisor 当副作用杀掉。

`kanet-start.sh` 全文档(整份脚本 grep)**没有任何地方重新拉起 supervisor**——只有
`kanet-boot-sequence.ps1` 步骤⑤单独显式起它(`console-supervisor.sh start`)。二者是两条独立触发
路径: 走完整开机序会补上, **手动 `bash kanet-start.sh`(日常最常见的重启方式)不会**。

**影响**: 2026-07-12 到 2026-07-17 期间反复观察到的"supervisor 死于无人知晓"现象(多次记账、多次
Bettor/J2/KANet-UI 各自"救回"又"复发"), 均可用这一条机制解释——不需要假设 OOM/崩溃/机器重启等
外部原因, 是**任何一次手动重启 console 的正常操作本身**在杀它, 且无任何日志/报错提示这件事发生
(`log "  停止 $name (PID $pid)"` 这行确实打了, 但混在一堆正常服务的停止行里, 没有专门标注
"这个不该停"或触发任何警示)。

## 修法(Bettor 裁定: (a) 为主 + (b) 双保险)

### (a) 治本: 停止循环跳过 console-supervisor.pid

```bash
for pidfile in "$PID_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  name=$(basename "$pidfile" .pid)
  if [ "$name" = "console-supervisor" ]; then continue; fi   # 不归 kanet-start.sh 管, 不该它杀
  pid=$(cat "$pidfile")
  ...
```

理由: `console-supervisor` 不是 `kanet-start.sh` 自己启动/管理的服务(它是一个独立的看门狗进程,
生命周期跨越多次 console 重启, 职责是"console 死了帮忙拉起来")——`kanet-start.sh` 的停止循环
语义应该是"停掉我这次要重新拉起的那批服务", supervisor 不在这批里, 不该被无差别扫进去。

### (b) 双保险: kanet-start.sh 末尾确保 supervisor 存活

在脚本末尾(所有服务启动完成后)加一段幂等的"确保 supervisor 在跑"逻辑, 直接复用既有的
`status`/`start` 子命令, 不重新发明检测逻辑:

```bash
# 双保险(2026-07-17, 根治 supervisor 误杀问题①的补充): 不管上面的 (a) 是否完全堵死所有路径
# (未来可能有其它脚本/手动操作同样清 pidfile 目录), 每次 kanet-start.sh 跑完都确认一次 supervisor
# 活着, 死了就带起来 —— 幂等(start 子命令本身已有 pidfile+kill -0 存活检查, 见 kanet-console-supervisor.sh:113)。
bash "$KANET_ROOT/scripts/kanet-console-supervisor.sh" start >> "$LOG_DIR/console-supervisor.log" 2>&1 || true
```

理由: (a) 解决的是"已知的这一条杀因", (b) 是防御性的"不管以后还有没有别的杀因, 每次
`kanet-start.sh` 收尾时都自证一次 supervisor 活着"——两条一起上是 Bettor 原话"双保险", 不是重复
劳动("治本" vs "兜底"是两个不同故障模式的两条独立防线, 都值得留)。

## 验证

- 静态: `grep -c 'console-supervisor' kanet-start.sh` 修前 0、修后 ≥ 2(跳过判断 + 末尾确保启动)。
- 动态(需要下个 console 重启窗, 不单独开): 跑一次 `bash kanet-start.sh`, 跑完后
  `bash scripts/kanet-console-supervisor.sh status` 必须显示 `alive`, 且 `console-supervisor.log`
  里没有出现"这次重启把它杀了又重新拉起"的双行(理想情况下 (a) 生效, supervisor 全程没被打断,
  只有 (b) 的幂等 `start` 调用看到"already running"式的静默通过——不应该看到一次
  杀死 + 一次重启的两行, 那说明 (a) 没生效只有 (b) 兜底住)。

## 不做什么

- 不改 `kanet-console-supervisor.sh` 本身(它的 `start`/`status`/`_run` 逻辑没有问题, 问题在
  `kanet-start.sh` 单方面误杀)。
- 不改 `kanet-boot-sequence.ps1` 步骤⑤(它本来就独立显式起 supervisor, 不受这个 bug 影响, 继续
  保留作为开机路径的显式一步)。
