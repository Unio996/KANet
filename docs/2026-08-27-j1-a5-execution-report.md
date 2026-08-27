# J1 · A.5 执行回报 —— 停 live llama → 256k ctx 生效（2026-08-27）

> **Status**: CURRENT · 回 `2026-08-27-bettor-j1-return-brief.md` §1（Owner 已批，J1 提权手）
> 通道②（commit 当消息）。全部为亲跑命令原始输出，对照臂 = `docs/2026-08-27-a5-baseline-before.txt`。

## 1. 结果：七项 + 三项补验，全过

| 项 | 前（11:55Z） | 后（12:00Z） | brief 预期 |
|---|---|---|---|
| PID / Start | 17428 / 08-25 10:31:04 | **4976 / 08-27 18:58:47** | 新实例 |
| `--ctx-size` | 1048576 | **262144** | ✅ |
| `llama_kv_cache` | 17408.00 MiB | **4352.00 MiB** | 预期 4352，**精确命中** |
| `/props n_ctx` | 1048576 | **262144** | ✅ |
| nvidia-smi VRAM | 28475 / 32607 MiB（87.3%） | **13117 / 32607 MiB（40.2%）** | 预期 ~13–14 GB ✅ |
| PrivateCommit | 30.15 GB | **13.58 GB** | 降 16.57 GB |
| OS free commit | 27.7 GB | **44 GB** | 停后 57 GB 过闸（≥35） |
| llm-watchdog | 0 | **0** | 未在跑 ✅ |
| :8000 LISTENING | `0.0.0.0:8000` PID 17428 | **`127.0.0.1:8000` PID 4976** | 见 §2① |

补验三项（brief 步骤 6）：

- **① 旧 17428 真没了**：`Get-Process -Id 17428` ⇒ `GONE`。
- **② 消费端真推理成功**（非 `/props`）：直接调生产代码路径
  `kasia-console/src/services/llm-fallback.js:121 callLLMWithFallback({system,user})` ⇒
  `{"ok":true,"text":"A5-INFERENCE-OK","tier":"llama"}`，耗时 0.3 s。
- **③ 停窗内 console-supervisor / llm-watchdog 均未 fire**：
  `logs/console-supervisor.log` 末三行为 `health fail #1/3` @ 06:34:57Z / 11:44:46Z / 11:49:49Z，
  **全部早于本次操作（11:55Z 起），无 `Console death detected` 行**；
  且 **console 仍为 PID 27412 监听 :3200（与操作前同一 PID）** —— 这是"没被重启"最硬的一条。

## 2. 两处按裁定做的判断（附证据）

### ① `--host` 由 `0.0.0.0` 收窄为 `127.0.0.1`

brief §1 步骤 5 的 NWT (20)+Bettor 裁定：**默认收窄，只有证实存在跨机消费者才保留 `0.0.0.0`**。
我的证据（动手前采集）：

```
netstat -ano | findstr ":8000"
  TCP    0.0.0.0:8000    0.0.0.0:0    LISTENING    17428      ← 仅监听，零 ESTABLISHED
消费端硬编码：kasia-console/src/services/llm-fallback.js:  const LLAMA_URL = 'http://127.0.0.1:8000';
```

⇒ 无跨机消费者证据，按最窄暴露原则收窄。收窄后 §1② 真推理通过，证明未打断任何本机消费者。
🟡 **残余**：netstat 是快照，间歇性跨机调用不会显形。若日后发现跨机消费者，改回一行即可（重 spawn 时把 `--host` 换回）。

### ② 未走 `kanet-start-headless.sh`，且新进程脱离 SSH 会话

- 遵 §0 CRITICAL：headless `:63-72` 会 kill `$PID_DIR/*.pid` 里每个 pid（含 console.pid）+ Stop-Process 占 :3200 者 = 重启 console。**全程未调用该脚本，也未调 `kanet-stop.sh`**。
- 手动 spawn 用 `Invoke-CimMethod Win32_Process Create`（**不是** `Start-Process`）：使新进程**不属于我的 SSH 会话 Job Object**，我登出不会把 llama 连坐杀掉（= 团队本周实证过的那个坑）。
- 参数逐字对 `kanet-start-headless.sh:134-140`，仅两处按裁定改：`--ctx-size` 从 `kanet.env LLAMA_CTX_SIZE` 读（262144，非硬编码）、`--host` 收窄。日志用 `>>` 追加（保留旧 kv 行作对照）。
- 手动内存闸（裸 spawn 绕过脚本内闸，故脚本内自判）：停 17428 后 free commit = **57 GB ≥ 35** 才 spawn；脚本对 `ctx≠262144` / 模型不存在 / `:8000` 未释放 / free<35 四种情况**一律 throw 停手**，不调阈值。

## 3. 🔴 顺带发现：agent adapter 层当前是挂的（Mind 正常路径降级中）

§1② 真推理的 stdout 首行：

```
[llm-fallback] tier 1 (agent adapter) failed: fetch failed
```

推理最终由 **tier 2（直连 llama）** 兜住，故功能可用；但这意味着 **Mind/Qwen 的正常路径（经 agent adapter）目前不通，全靠 fallback**。
与本次 A.5 无因果（adapter 不经 :8000），停 llama 前即如此。**不在我域，报给 KANet-UI/J2 定位。**

## 4. 未做 / 边界

- 未启用任何计划任务；`KANet-KaspadWatchdog` 仍 **Disabled**（遵 VB-8，等 `isSynced ∧ daa>0`）。
- 未碰 console、未碰 kaspad、未推任何代码改动（Console 僵尸补丁仍 staged 待 NWT 审）。
- 节点状态（同时段）：全新 IBD 已过 headers 100% → UTXO 集 32,493,055 个导入完 → 现处区块体阶段，
  `daa=77,770,069` 且在爬，`tipCount=3`（对比坏库 4148）。距 J2 清单步 0 闸（`daa>80,095,687`）
  按当时速率（~1,089 daa/min）约 35 h。**A.5 与该闸正交**（J2 清单四条澄清⑤原话），故未等。
