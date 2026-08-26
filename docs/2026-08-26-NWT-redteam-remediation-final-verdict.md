# NWT 终 verdict — start 脚本 remediation(§A + §B/§C)

> 作者 NWT · 2026-08-26 · 被审 = `docs/2026-08-26-kanet-ui-start-script-remediation-design.md`
> **读的 commit(git log -1 确认,进 verdict)**:remediation 稿 = **`1f0a8589`**(= §A v0.2 `aa26b1b4` + §B/§C v0.2,同一文件累积)。
> 前序:§A v0.1 NWT `32b47138` = PASS-WITH-MUST-FIX(3改)· §B/§C v0.1 NWT `d9b7c37a` = PASS-WITH-MUST-FIX(3改)。本文核 v0.2 是否把 6 条 MUST-FIX 全落。

## 1. §A 三改逐条核实(HEAD `1f0a8589`)
| MUST-FIX(v0.1) | v0.2 落点 | 核 |
|---|---|---|
| ①归因半错:mmap 模型≠私有 commit | changelog① + :34「原稿'系统 commit 主体=mmap 模型'已被证伪(log mmap=true + CPU_Mapped 795.70MiB),删该句」+ :36「'降 ctx 缩小系统 commit'=未证」+ **A.5 :64 硬前置**「改默认值写进 kanet.env 的前提 = 低 ctx 实测私有 commit;测出前不写'降 ctx 缩小 OOM 足迹';若不随 ctx 显著降则 OOM 防护全靠 §0.5 内存闸」 | ✅ 归因删+改claim gate住+A.5升硬前置 |
| ②256k 防回归 | changelog② + conversationHistory cap 实证 + 防回归注 | ✅ |
| ③第五 ctx 站 llm-watchdog:49 | **A-1c :56** 新增改动站(`process.env.LLAMA_CTX_SIZE||'262144'`)+ 钉「必须同改 + 补 :8000 守卫 + 内存闸」+ A.5 停机步加「确认 llm-watchdog 未跑」 | ✅ 第五站进改动表 |

## 2. §B/§C 三改逐条核实
| MUST-FIX(v0.1) | v0.2 落点 | 核 |
|---|---|---|
| ①#9c flock 本机不存在 + mkdir 锁孤儿 | :132「删 flock(command -v flock=NOT-FOUND 已自核);mkdir 锁 + 锁内 PID + stale-PID 回收(SIGKILL 残留锁⇒永不起 supervisor=8/23 形态)+ EXIT trap;备选后验去重 loser exits」;flock 全稿仅剩 2 处**均为"删 flock/NOT-FOUND"引用**,无 flock 使用 | ✅ flock 删净 + mkdir 全套 + 孤儿回收 |
| ②#9b 可继承 env fail-open | :131「不用 KANET_SUPERVISED 可继承 env;改显式 `--supervised` 参数(作用域仅这次、不继承子树);禁 export=1(操作员 shell 残留→静默不起监工=复刻 8/23 无报错);备选正向核父进程」 | ✅ 改显式参数 + fail-open 讲清 |
| ③C heartbeat 自报族 | :169「heartbeat 两向都失(fresh≠活/stale≠死,10-20min 合法静默);判重防双开可用;**判死绝不以 heartbeat 唯一触发**,配进程存活 + 阈值≥15-20min」 | ✅ 非唯一触发 + 阈值 + 两用途分开 |
| (非阻塞)sidecar 活判据 | :121「幂等'活'判据看端口 LISTEN 非进程存在(wedge 进程在但端口不 LISTEN)」 | ✅ 采纳 |

## 3. 终 verdict
- **remediation 稿(§A + §B/§C, `1f0a8589`)= 通过终核, doc-layer GREEN。** 6 条 MUST-FIX 全落, 非阻塞项(sidecar 端口判据)也采纳。设计闭合。
- **GREEN 边界(同探针稿口径, Bettor 已抄 ledger)**:GREEN = 设计闭合 + 落码前条件写进稿, **不是 ship**。落码是 Owner 三决(§A 的 llama ctx / §B start-脚本改 / §C 接位入库)回来后的独立轮。
- **落码前硬条件(实施轮 NWT 逐处 git show 核)**:
  1. **§A ①**:改 kanet.env 默认值**之前**必须先跑 A.5 低 ctx 重启实测私有 commit —— 这是硬前置, 没测出私有 commit 与 ctx 的关系前, 不许把"降 ctx 治 OOM"当结论(内存闸 §0.5 才是 8/23 真防线)。
  2. **§A ③**:llm-watchdog:49 与两 start 脚本三处 ctx 同源 + llm-watchdog 补 :8000 守卫, 缺一则 taskkill 后 1M 重拉复活双开源。
  3. **§B ①②**:mkdir 锁的 stale-PID 回收 + EXIT trap 必须真实现(不是只写"用锁");`--supervised` 是参数不是可继承 env —— 实施轮验这两点, 否则孤儿死锁/fail-open 静默关监工。
  4. **§B/§C**:内存闸(§0.5)装全 spawn 点(kaspad-watchdog + 两 start 脚本 llama 段 + llm-watchdog)—— 见探针稿终 verdict §7.3, 治 8/23 主因(llama 双开)。
  5. **两步落地**:VB-1 纯重构等价臂先证零行为变更, 再逐条 open 修法单独 diff;channel-bridge :3100→:3200 并入本批。
- 关3 浏览器/端到端未做(纯设计稿无运行物);实施轮 KANet-UI 落码后逐处 diff GREEN 才推。

## 附:本轮 remediation 红队全链 commit
- §A v0.1 verdict = `32b47138` / §B/§C v0.1 verdict = `d9b7c37a` / 本终 verdict(A+BC v0.2)= 本文件。
- 被审稿:§A v0.1 `b8e5908a` → v0.2 `aa26b1b4`;§B/§C v0.1 `7a4b7ad7` → v0.2 `1f0a8589`(终核对象)。
