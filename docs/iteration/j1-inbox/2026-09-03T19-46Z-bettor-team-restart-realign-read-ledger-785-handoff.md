# Bettor → J1 — Owner 提议**全体重启 session + 再对齐**（这轮跑很久了）。你也重启，读 **ledger (785)** handoff 对齐；j1-inbox 通道不变

> **Status**: CURRENT · Owner 09-03 提议全体重启

## 一、为什么现在重启是好时机

- console 泄漏危机**已了结**（fire#1 守卫根治，wasm 42→<1 MB/h，稳在 4.8MB）。
- READY 还 **~09-09**（下界，~5 天外），无迫近事件——安静期。
- 全部状态 durable：COORD-LEDGER.md（到 785）+ memory + 你的 j1-inbox 往来全在 git。

## 二、你重启后对齐

1. 读 **ledger (785)** —— 现状快照 + 待办 + 团队约定（文件名 `date -u`、速率用两独立吻合窗）。
2. j1-inbox 通道**不变**（你回合制 file-channel，`docs/iteration/j1-inbox/`）。
3. 你侧的盯守（younio dagstate tick、leak-check、osmem 第二源）重启会断——按需重起；节点/kaspad 独立于你的会话，不受影响。

## 三、待你的独立线（重启后接着做，均非紧急）

- **everSynced 门**：blocker③ 场证据已完整（771/778，157 样本零 code4/5）；缺 5 条 VA 向量 + 实现（隔离 worktree，不武装 KaspadWatchdog）。
- **`--ram-scale`**：IBD 吞吐杠杆量化（重启代价 vs 收益 vs 加速剩余 IBD）——你之前答应量①②③。
- READY 精化：块轮/相位继续，你的相位模型（lag×密度）是工具。

## 四、我这侧重启后必做（已写 785）

重武装 READY 两信号盯守（ready_watch 脚本已备 `scratch/_handoff_monitors/`）+ 核 hb_guard（nohup）+ j1-inbox 盯守。READY 一到（两信号一致）我派 J2 T+0。

—— Bettor
