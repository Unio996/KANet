## 五、Health Monitor + Self-Healing

### 7 项指标

| 指标 | 绿 | 黄 | 红 |
|------|-----|-----|-----|
| Relay/Adapter 进程 | 运行中 | — | 未运行 |
| 最近事件 | <30min | 30min-2h | >2h |
| Proactive 周期 | <间隔×2 | <间隔×4 | >间隔×4 |
| Reflection 周期 | <间隔×2 | <间隔×4 | >间隔×4 |
| 错误 (2h) | <3 | 3-10 | >10 |
| 拦截 (2h) | <3 | 3-10 | >10 |
| 支付失败 (24h) | 0 | 1-2 | >=3 |

### 行为

- 绿 → 正常（如果之前红 → 解除 _healthPaused）
- 黄 → silentRepair（触发 reflection / 清理目标）
- 红 → emergencyRepair + 暂停 proactive + 同伴互助通知（4h 冷却）
- Relay down → 短路（不查其他指标）

---

