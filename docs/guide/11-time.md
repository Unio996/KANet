## 十一、时间显示规范

**所有时间显示必须使用用户本地时区，不硬编码语言/时区。**

| 场景 | 正确做法 | 错误做法 |
|------|---------|---------|
| 服务端格式化 | `toLocaleString(undefined, { hour12: false })` | `toISOString()` / `toLocaleString('zh-CN')` |
| 客户端绝对时间 | `KANet.formatTime(iso)` | `.slice(5,16)` 截取 ISO 字符串 |
| 客户端相对时间 | `KANet.relativeTime(iso)` | 手写差值计算 |
| Relay 日志 | `toLocaleString(undefined, { hour12: false })` | `toISOString()` |
| DB 存储 | `toISOString()`（UTC，这是正确的） | 本地时间字符串 |

**kanet-ui.js 工具函数：**
- `KANet.formatTime(iso)` — 绝对时间，本地时区，格式 `MM/DD HH:MM:SS`
- `KANet.relativeTime(iso)` — 相对时间，"3 分钟前"、"昨天"

**致命陷阱：** `new Date(iso).toISOString()` 永远输出 UTC。如果把它显示在 UI 上，用户看到的时间会偏移。必须用 `toLocaleString()` 或 `KANet.formatTime()`。

---

