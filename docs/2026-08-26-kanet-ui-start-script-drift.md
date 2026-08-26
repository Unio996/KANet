# kanet-start.sh (A) vs kanet-start-headless.sh (B) 逐段漂移表（只读 · 不改脚本）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-26 · Bettor 派工 (E) · 读的是 `bshard-m3-deploy` @ `ac955242` 工作树, 行号以此为准。
> **目的**: ① 若 NWT 对 30 GB commit 出结论要降 `--ctx-size`, 改动面就是本表 §3, 一处不漏; ② 两支脚本**谁在什么时候被谁调用**(§1)——人工起走 A, supervisor 自愈走 B, 8/23 之后本机 console 的每一次拉起**全是 B**(§1.2 实证), 所以"改了 A 忘了 B"= 改了一份没人跑的。
> **每条标**: `相同` / `只在 A` / `只在 B` / `都有但值不同`。行为影响列只写读码能定的, 猜的标 `[INFERRED]`。

## §1 谁调谁 `[MEASURED]`
### 1.1 调用方
| 调用方 | 调哪支 | 出处 |
|---|---|---|
| 人工 `bash kanet-start.sh` / `scripts/kanet-boot-sequence.ps1` 开机序列 ④ | **A** | `kanet-boot-sequence.ps1:93-108`(显式 Git-Bash 绝对路径起 A, 且有 :3200 端口守卫因为 A 自己没有) |
| `scripts/kanet-console-supervisor.sh` 判 console 死(3/3 fail) | **B** | `kanet-console-supervisor.sh:129-131` `bash "$KANET_ROOT/kanet-start-headless.sh"` |
| A 末尾 / B 末尾 | 都拉 supervisor `start`(nohup `_run`) | A:407 无条件(start 自身幂等) / B:149-158 先查 pidfile 活再 start |
### 1.2 本机最近三次 console 拉起全是 B
`logs/console-supervisor.log` `invoking kanet-start-headless.sh` 累计 **1,246 次**; 最近三次 `2026-08-23T19:22Z` / `08-25T03:31Z`(=本地 8/25 10:31) / `08-25T20:03Z`(=本地 8/26 03:03, 即现 console 27412)。A 的 launcher 日志 `logs/kanet-start-launcher.log` 最后写于 **08-21 22:37**; B 的 `logs/kanet-start-headless-launcher.log` 最后写于 **08-26 03:03**(内容 = 那次 JSON: console ready, llama "already serving :8000 (shared llama, reused)")。
⇒ **live llama-server 17428(8/25 10:31:04 起)= 8/25 03:31Z 那次 B 起的**(:8000 在 8/24 重启后是死的, B:104 走 fallback spawn; `logs/llama-server.log` 08-25 10:31 写入、模型 = kanet.env 的 Q6_K、`n_ctx = 1048576` 三点吻合)。**不是 C:\KANet 主网树起的**(那两支用 `--ctx-size 262144`, 见 §3)。

## §2 逐段对照
| # | 段 | A `kanet-start.sh` | B `kanet-start-headless.sh` | 判 | 行为影响 |
|---|---|---|---|---|---|
| 1 | shell 严格模式 | `set -euo pipefail`(:6) | `set -uo pipefail`(:2) | 都有但值不同 | A 任一命令非零即整脚本退出; B 容错继续(设计如此: supervisor 场景不能因小错卡死) |
| 2 | launcher 自重定向日志 | `logs/kanet-start-launcher.log`(:29) | `logs/kanet-start-headless-launcher.log`(:19) | 都有但值不同 | **两个文件名**(J2 今日抓到的那条); 都是每次截断只留最新 |
| 3 | 彩色/banner/`clear` | 有(:31-49) | 无 | 只在 A | 无 |
| 4 | `KANET_TEST_MODE` | `export KANET_TEST_MODE=${KANET_TEST_MODE:-1}`(:15) | **无** | 只在 A | 🔴 B 起的 console **不带** `KANET_TEST_MODE` ⇒ `/api/test/reset_peer` 不注册(A:13-14 注释); 现 console 27412 是 B 起的 ⇒ test-framework 的 cleanup_peer_broker_state 在当前进程上**不可用**(除非 kanet.env 里有该 key——`[MEASURED]` 没有) |
| 5 | 段落顺序 | 停旧进程(:51-85) **在** env 加载(:87-147) **之前** | env 加载(:21-61) **在** 停旧进程(:63-83) **之前** | 都有但顺序不同 | 见 #7: A 的端口释放在读 kanet.env 之前跑, 用的是默认端口 |
| 6 | `CONSOLE_PORT` 默认 | `${CONSOLE_PORT:-3400}`(:20), env 加载时 `PORT→CONSOLE_PORT`(:118) | `3200` fallback(:10), env 后 `CONSOLE_PORT="${PORT:-$CONSOLE_PORT}"`(:51) | 都有但值不同 | 最终都 = kanet.env `PORT=3200`; 但 A 在 :75 那一刻 CONSOLE_PORT 仍是 3400 |
| 7 | 强制释放 console 端口 | :75-84 用 `$CONSOLE_PORT`——**此时 = 3400**(见 #5/#6) | :74-81 用已派生的 3200 | 都有但值不同 | 🔴 A 的"释放端口"实际释放的是 :3400, 对 :3200 **无效**; 与 `kanet-boot-sequence.ps1:64-69/94` 说的"kanet-start.sh 对 :3200 无端口占用检测"吻合(那边靠外部守卫补)。A 只靠 pidfile 杀 console |
| 8 | 停旧进程: 杀法 | `Stop-Process -Force` 失败才 `kill`(:65-66) | 只 `kill "$pid"`(:69) | 都有但值不同 | pidfile 里是 bash 伪 PID(记忆 (606) 判据: bash 伪 PID≠Windows PID), `kill` 对 bash 起的子 shell 有效、对 OS 进程未必; A 双保险 |
| 9 | 停旧进程: 跳过 `console-supervisor.pid` | **跳过**(:62, 2026-07-17 修) | **不跳过**(:65-72 遍历全部) | 只在 A | 🟡 B 被 supervisor 调用时会 `kill` supervisor 自己的 pidfile PID 再 `rm` pidfile; 之后 :151-157 因 pidfile 已删而重新 `start` 一个 ⇒ 每次自愈 = supervisor 自杀重生 `[INFERRED·与 (607) "supervisor 每次 restart 后多一条 start" 的观察一致]` |
| 10 | 停旧进程: tg-bot 按 cmdline 清 | 有(:73) | 无 | 只在 A | B 场景由 console tg-bot-manager 单一 owner 兜, 差异可接受 |
| 11 | `HEADLESS_NO_KILL` 门 | 无 | 有(:64) | 只在 B | — |
| 12 | env 加载: 全量 export | `export "$k=$v"`(:100) | `export "$k=$v"`(:38) | 相同 | 同源(r551/r472) |
| 13 | env 加载: case 块 | 43 个 key 做变量名转换(:101-144, 含 `KASPA_NODE`/`KASPA_WS_PROXY_*`/`PORT`…) | 3 个 key(:39-43) | 都有但值不同 | 因 #12 全量 export, 功能上只有 `PORT→CONSOLE_PORT`(B 在 :51 单独做了)和 ws-proxy 用的两个 key(B 没 ws-proxy 段, 不需要)有实义; 其余 A 的 case 是冗余 |
| 14 | 加密密钥缺省生成 | 有 + warn(:152-158) | 有, 静默(:55-61) | 相同(输出不同) | — |
| 15 | **ws-proxy**(:17310→17210) | 有(:162-207, 含 kaspad TCP 探测 + spawn + pidfile) | **无** | 只在 A | 🔴 B 的 #9 循环会按 `kaspa-ws-proxy.pid` 杀掉它, 而 B 不重起 ⇒ **每次 supervisor 自愈后 ws-proxy 消失**。`[MEASURED]` 现在 :17310 **无监听**, `logs/pids/` 只剩 `console-supervisor.pid`+`console.pid`。影响面 = 依赖 ws://127.0.0.1:17310 的客户端(kasia.fyi 浏览器); relay/console 走 `KASPA_RPC_URL=ws://127.0.0.1:17210` 直连不受影响 |
| 16 | llama: exe/model 默认路径 | `$KANET_ROOT/tools/...` / `$KANET_ROOT/models/...Q4_K_M`(:213-214) | `C:/KANet/tools/...` / `C:/KANet/models/...Q4_K_M`(:90-91) | 都有但值不同 | 两者都被 kanet.env `LLAMA_SERVER_PATH`/`LLAMA_MODEL_PATH`(Q6_K)覆盖 ⇒ 现网无差; 去掉 env 后 A 的默认在本机是死路(A:210-212 注释自认) |
| 17 | llama: "已在跑"判据 | `netstat :8000 LISTEN`(:225) | `curl /v1/models` 成功(:101) | 都有但值不同 | B 更严(端口占着但没答 = 不算活 → 会再 spawn 一个撞端口; A 则跳过)。`[INFERRED]` 两种都不会杀旧 llama |
| 18 | **llama: 启动参数** | `--model $LLAMA_MODEL --host 0.0.0.0 --port 8000 --n-gpu-layers 99 --ctx-size 1048576 --cache-type-k q8_0 --cache-type-v q8_0 --threads 8 --flash-attn on`(:232-238) | 逐字相同(:106-112) | 相同 | **`--ctx-size 1048576` 两处硬编码, 无 env 键**(kanet.env 没有 `LLAMA_CTX*`) |
| 19 | llama: 等待就绪 | 最多 120s 轮询 `/health`(:243-248) | 不等(spawn 即走, JSON 标 `ready:false`) | 都有但值不同 | — |
| 20 | llama: 缺文件时 | warn 一行(:218-220) | JSON `skipped/reason` | 都有但值不同 | — |
| 21 | console.log 处理 | 先 `mv console.log console.log.prev` 再截断(:265-266) | **直接截断**(:122) | 都有但值不同 | 🔴 B(= 每次 supervisor 自愈)**不留上一份 console.log** ⇒ 死前现场丢失——正是接位文件"重启前先 cp console.log"那条痛点的机制根源; `[MEASURED]` `console.log.prev` 停在 08-21 22:35(A 最后一次跑) |
| 22 | console 启动命令 | `node ${KANET_NODE_FLAGS:-} src/index.js`(:279), 显式再传 8 个 env(:268-278, 因 #12 已 export 属冗余) | `node --max-old-space-size=4096 src/index.js`(:129), 显式传 5 个 env | 都有但值不同 | 🔴 **V8 堆上限只在 B 有**(4096MB 硬编码); A 走 `KANET_NODE_FLAGS`(kanet.env 没设 ⇒ A 起的 console 用 Node 默认堆)。接位文件已记"`--max-old-space-size` 卡的是 V8 老生代堆不是 RSS"; 但 A/B 起的 console 在这一维不是同一个进程形态 |
| 23 | console 就绪等待 | 15s(30×0.5s), 失败 `exit 1` + tail 日志(:284-296) | `HEADLESS_TIMEOUT` 默认 30s, 失败**不退出**, 继续拉 supervisor、写 INGEST_SECRET、JSON `ok:false` exit 1(:136-145, :185-205) | 都有但值不同 | — |
| 24 | **Bridge stack**: cc-bridge :9100 / qwen-worker / channel-bridge / owner-bot / test-cron | 全有(:307-386, 各带幂等检查 + pidfile) | **全无** | 只在 A | 🔴 同 #15 机制: 它们的 pidfile 在 B 的 #9 循环里被杀且不重起 ⇒ **supervisor 自愈一次, 整个 bridge 栈就没了**。`[MEASURED]` 现在 :9100 无监听, 全机 node.exe 无 channel-bridge/owner-bot/test-cron/qwen-worker(41 个 node 全部归属已核, 见 (A) 报告)。影响: **owner-bot(Owner 的 dev-coord 远程指挥 bot)与 channel-bridge 自 8/23 起不在**——需要 Bettor 判是否是问题 |
| 25 | supervisor 拉起 | 无条件 `start`(:407) | pidfile 活则跳过, 否则 `start`(:149-158) | 都有但值不同 | 两者都走 `start`→`nohup _run`(supervisor.sh:175-181) = (606)/(607) 记录的 flap 形态; 计划任务直接 `_run` 是另一条线 |
| 26 | INGEST_SECRET 回写 kanet.env | 有(:391-400) | 有(:160-168) | 相同 | — |
| 27 | TG bot | 不起(注释 :298-303) | 不起(注释 :170-174) | 相同 | — |
| 28 | 结尾 | `tail -f console.log` 阻塞(:428-433) | JSON 一行 + exit code | 都有但值不同 | 设计如此 |
| 29 | IB Gateway 注释 | 有(:388-389) | 无 | 只在 A | 无 |

## §3 `--ctx-size` 改动面(若 NWT/Owner 拍降)
| 文件 | 行 | 现值 | 备注 |
|---|---|---|---|
| `D:\kanet-tn12\kanet-start.sh` | **235** | `--ctx-size 1048576` | 人工起 |
| `D:\kanet-tn12\kanet-start-headless.sh` | **109** | `--ctx-size 1048576` | supervisor 自愈起——**live 17428 就是它起的** |
| `C:\KANet\kanet-start.sh` | 193 | `--ctx-size 262144` | 主网树, **不在本仓**; 同一台机同一块 GPU 的第三份副本, 值已不同 |
| `C:\KANet\kanet-start-headless.sh` | 78 | `--ctx-size 262144` | 同上第四份 |
- 🔴 **改脚本 ≠ 生效**: A:225 / B:101 的 :8000 守卫都会"已在跑就复用" ⇒ 新值只在 llama-server **被停掉后的下一次拉起**才生效。停它 = 显式动作(`kanet-stop.sh:69-76` 已明确**不**扫杀 llama-server, 需手工 `Stop-Process 17428`)= live 动作, 走报备。
- `[DESIGN-CHOICE·建议, 不在本稿落]` 两支脚本改成 `--ctx-size "${LLAMA_CTX_SIZE:-<新默认>}"`, kanet.env 加 `LLAMA_CTX_SIZE=`, 与 `LLAMA_MODEL_PATH` 同一处管——这样 A/B 只剩一个真相源, 本表 #18 那种"两处硬编码逐字相同"不再靠人眼维持。C:\KANet 两份归主网树, 另议。
- 单位/含义提醒: `n_ctx_train = 1048576`, `n_ctx_orig_yarn = 262144`(`logs/llama-server.log:74,105`)——模型原生 262144, 1M 是 YaRN 外推; KV cache(q8_0)大小与 ctx 成正比, 4 slots ⇒ commit 随之。数值定多少归 NWT 结论, 本稿只给改动面。

## §4 本表暴露的、与 ctx-size 无关但同病("改 A 忘 B")的项(供 Bettor 排序, 本稿不修)
1. **#24/#15**: B 杀 bridge 栈与 ws-proxy 的 pidfile 却不重起 ⇒ 每次自愈后 owner-bot / channel-bridge / cc-bridge / qwen-worker / test-cron / ws-proxy 全没。`[MEASURED]` 现网正处于这个状态。
2. **#21**: B 不归档 console.log ⇒ 自愈重启即丢死前现场(与接位文件 ⓪ 步痛点同根)。
3. **#4**: B 不带 `KANET_TEST_MODE`。
4. **#9**: B 会杀 supervisor 自己的 pidfile 进程再重生(疑 (607) flap 来源之一, `[INFERRED]`)。
5. **#7**: A 的端口释放对 :3200 无效(默认 3400 在 env 加载前被用掉)。
6. **#22**: 只有 B 起的 console 有 `--max-old-space-size=4096`。
🔨 根治方向(建议): A/B 共用一份 `lib/kanet-start-common.sh`(env 加载 / llama 参数 / console 启动 / 日志归档 四段), A 只多 UI 与 bridge 栈, B 只多 JSON——"两份脚本逐字相同的段"应当是同一段代码, 不是两段碰巧相同的代码。

## §5 验证方法(全部只读, 可复跑)
- 调用关系: `grep -n "kanet-start" scripts/kanet-console-supervisor.sh scripts/kanet-boot-sequence.ps1`
- 谁最近跑过: `ls -la --time-style=+%m-%d\ %H:%M logs/kanet-start-launcher.log logs/kanet-start-headless-launcher.log`; `grep -c "invoking kanet-start-headless" logs/console-supervisor.log`
- live llama 来源: `grep -a -n "n_ctx\|gguf" logs/llama-server.log | head`; `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Select CreationDate`
- 现网缺失: `netstat -ano | grep LISTENING | grep -E ":(9100|17310) "`(空 = 不在); `ls logs/pids/`
- ctx 副本: `grep -n "ctx-size" kanet-start.sh kanet-start-headless.sh C:/KANet/kanet-start.sh C:/KANet/kanet-start-headless.sh`
