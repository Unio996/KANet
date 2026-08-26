# llama 256k ctx 切换 checklist（只读参考 · 不自动执行 · A.5 live 动作）

> KANet-UI 2026-08-26 · remediation §A.5 落地。**本文件是给操作员看的步骤，不是脚本，不自动跑。**
> 前置: 内存闸+ctx 代码(commit dd1dcd72)已 NWT GREEN + Bettor push + Owner 批定时间窗。
> 🔴 停 17428 = live 动作(Mind/Qwen 断几分钟)。**执行者 = Bettor/操作员，KANet-UI 不自行重启**(接位红线)。

## 为什么需要显式停
- 两 start 脚本 :8000 守卫"已在跑就复用"(kanet-start.sh:225 netstat / headless:101 curl) ⇒ 新 ctx 只在 llama 被停后下次拉起才生效。
- kanet-stop.sh:69-76 明确不扫杀 llama(防误杀 qclaude) ⇒ 必须显式 taskkill。

## 六步(逐步核，不跳)
```
① 报备 + Owner 批(已在决策窗内确认)；确认 kanet.env 有 LLAMA_CTX_SIZE=262144。
🔴② 改默认值硬前置实测(NWT ①): 停前记 llama 17428 私有 commit 基线:
     Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Select ProcessId,PrivatePageCount,CreationDate
     (现基线 PID 17428 ~30.2GB; 停后以 256k 重拉再量, 对比得"降 ctx 是否降私有 commit"的实测数——这是能否声称
      降 ctx 缩小 OOM 足迹的唯一依据; 测出前稿里不写该主张)
🔴③ 确认 llm-watchdog 未跑(NWT ③): 
     Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*llm-watchdog*' }
     必须空——否则它会在 taskkill 后用旧行为重拉(已补守卫但本轮不启用它)。
④ 记 PID+CreationDate: Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'"  (现 17428)
⑤ 停: taskkill //PID 17428 //F
🔴⑥ 确认 :8000 真释放再重拉: netstat -ano | grep ":8000 "  无监听后, 才拉。
     重拉 = 跑一次 kanet-start.sh 的 llama 段(或整脚本), :8000 守卫走 fallback spawn 带新 ctx。
     内存闸会先判 FreeVirtualMemory(此刻停了 llama 会释放 ~30GB, 空间必够, 应放行)。
```

## 验收(对照臂)
- 新 llama-server.log: `llama_kv_cache: size = 4352.00 MiB` (256k) ≠ 旧 17408(1M)。
- /props: `curl -s http://127.0.0.1:8000/props` → n_ctx=262144。
- VRAM: 用量从 ~27GB(1M) 降到 ~13-14GB(model 6.2 + KV256k 4.35 + compute 3.1)。
- 私有 commit: 量新实例 PrivatePageCount, 收 ②的对比数(记进 ledger + remediation §A.2 收口"是否降 commit"那条)。
- 内存闸: 日志无 refuse-start(内存充足放行); 若停前误在紧机跑会看到 refuse-start:low-commit/commit-unknown。
- Mind/Qwen: 重拉+模型加载(~60s)后恢复; 期间 adapter 回退。

## 回滚
- 若 256k 出问题(不应该, KV 更小): kanet.env 改回 LLAMA_CTX_SIZE=1048576 + 重复⑤⑥。
- 若新代码本身有问题: git revert dd1dcd72(Bettor), 恢复硬编码 1M + 无闸。
