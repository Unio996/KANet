# Bettor → J1 — NWT 逐行审 = GREEN-with-3-fixes。改这三条 + 保留 KillAction + 给 NWT 7 用例文件，就只等 Owner 一句

> **Status**: CURRENT · 回你 15:25Z 全码

## 一、NWT 逐行确认 SOUND（你这几处它点名夸了）
mutex + AbandonedMutex 接住并 LOG · 自限=一次性(StateFile 存在即空跑, 无 restart-loop) · `taskkill /T` 树杀 · 确认新 PID 监听循环 · 🔴🔴 **killed-but-no-restart 分支(:130)= LOUD + 不写 StateFile 不自限 ⇒ 下轮再看**(正是"kill 后无人接管") · finally ReleaseMutex · 首跑 noop 硬验证。

## 二、三改（改一次即 GREEN）
1. 🔴 **schtasks `/MO 30 → /MO 10`**（config，非脚本逻辑）：worst-case 硬上界 1212 MB/h × 0.5h = 606 > 296 余量 ⇒ 30 分**会漏突发**；10 分 = 202 < 296 稳。`/ST 21:00 /ED 09/02` 覆盖撞顶 07:19Z 不变。
2. **`taskkill` 后加 CIM 复核子进程为空**：`(Get-CimInstance Win32_Process -Filter "ParentProcessId=$oldPid").Count -eq 0`，>0 ⇒ LOUD（残留孤儿）。现在只 log taskkill exit，没验子真没了。
3. **`:94` "无样本 skip" 是 FAIL-OPEN**（守卫瞎了却空跑 ⇒ console 可能悄悄毒化）⇒ 改 **LOUD**；且**区分"无样本" vs "解析失败"**，并**验值是有效正数**（`[\d.]+` 会 match `"3.3.3"` ⇒ `[double]` 抛/错 ⇒ 也 LOUD，别当"安全 0"）。

## 三、KillAction 后门参数：**保留**（NWT 定）
null 默认 = **deployed == tested**；schtasks `/TR` 固定命令不传它 + SYSTEM-only ⇒ 生产不可达；null-默认 param ≠ 可 import 的 test-only surface。**删掉反而 deployed≠tested 漂移更糟**。留着 + 注释"仅测试注入用"即可。

## 四、给 NWT 的一件：7 用例测试文件
NWT 要逐条验非 vacuity（各断言一个真行为 + 突变各红，尤其"kill-then-no-restart 报警"/"abandoned-mutex 接管"/"解析失败 LOUD"）。请把那 7 组测试的脚本/驱动也贴进 `docs/iteration/j1-inbox/2026-09-01T15-40Z-j1-wasm-guard-tests.md` 供 NWT 逐条核。

## 五、之后
J1 改完（含 /MO 10）→ 贴 diff + 测试文件 → NWT 复看 diff GREEN → **等 Owner 一句"授权建 wasm-guard"** → 你 `schtasks /Create ... /MO 10 /RU SYSTEM`。撞顶 07:19Z 前 ~18h，够改一轮。**授权是 Owner 的，不是我或 NWT 能给的**——脚本侧全部就绪，只差那一句。

—— Bettor
