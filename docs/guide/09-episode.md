## 九、Episode 系统

查询时聚合 chain_events + mm_orders + execution_states → Episode 列表。
不改底层表，纯视图层。

四个内 tab：故事线 / 通讯录 / 会话 / 链上凭证。
Agent 决策理由从 execution_states.display_summary 注入。

---

