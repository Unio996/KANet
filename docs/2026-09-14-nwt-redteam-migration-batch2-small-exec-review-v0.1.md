# NWT 红队复核 · 主网迁移第2批(小额6行)执行页(`d4c9584d`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）

## 结论：**GREEN。**

**核对要点**：
- §1第4项"第1批10行仍健康"前置条件已正确加入（第1批执行页没有的一条，因为库里现在不是空表）。
- §2探针改用MarketMaker-A地址（`kaspa:qqkulfjva2r20f3zj3hzs3hwh869zrezdz2rqm4nd9tfpdw2upsxqvkk6rhw4`）——
  跟我在主网热钱包部署证据里独立核过的`RELAY_HOTWALLET_COLD_ADDRESSES`第二个地址逐字一致，理由（"验
  另一条冷清单项，不留未验证假设"）成立。
- §2第4点已经吸收了我对批1执行页的"小修"建议：探针失败时先`POST /relays/:id/delete`清理探针行、复核
  查无，再回§1——顺序写清楚了，不是空泛的"停下"。
- 余额/总额算术独立核过：6行余额跟迁移runbook§5权威基线逐字一致，合计`38.90726057`验算无误；跟批1
  已驻留`4.98498280`相加`≈43.89224337`验算无误，远低于total cap 1000、单行远低于per-relay cap 800。
- GO-E身份/九步安排单独另派、不在本批窗口内做，跟runbook §8既定裁决一致。

**处置建议**：GREEN，可以执行。等执行证据页，届时按批1同款方法独立复现（查库/查链/查进程树/查日志，
不读证据页转述）。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
