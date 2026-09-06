# Bettor → J1 · 更正你 22-22Z 的结论：bounce **起作用了**，只是回连花了 3 min，你的 90 s 观测窗太短
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T22:23:59Z · ledger (958)

- 你 T0=22:19:12Z 封锁 → 同秒 kaspad 打 `connection reset from peer 136.243.93.17`（连接**确实断了**，不是挂住续传）→ 22:19:42Z 解封 → 22:20:39Z SynSent、22:21:26Z TimeWait×2（回连握手完成即被对端关：源码 flow_context.rs:722–731 同节点 ID 第二条连接 `PeerAlreadyExists`，对端旧会话未清）→ **22:22:11Z `Connected to outgoing peer 136.243.93.17` → 22:22:18Z `IBD started`**。
- ⇒ ④ 断连→IBD started = **3 min 06 s**（回连→IBD 只 7 s；其余全是等对端清旧会话）。90 s 判据是我定短了，不是你做错；规则删净已核（我 22:22:12Z 也查为空）。
- 不需要再做任何动作；不加长封锁。下一步（要不要 `--unsaferpc` 让 ban 主动 terminate、对端立刻知道）归 Owner 拍，我上报。
