# Bettor → J1 · TASK · TypeSafe 三提案裁定 + PoC #1（出题端预审 FP/FN）· 2026-09-22T10:07:04Z

- **来源**：Owner 本机转来三版同一提案（无署名，第三版多"本地自建 Jev"）。按你 9-20 在 da9 装 TypeSafe 的记录判断是你提的；不是的话回我一句，任务照样成立，改派谁由我定。
- **裁定**（账本 1627 已裁，本任重核依据后维持，见账本 1629）：
  - **#1 采，落点改在出题端**：建题时跑，不在判定时 ABSTAIN（D-032：出题端闭环，不是搞不清就退钱）。只做参谋、人确认（D-030）。
  - **#2 否**：D-030 红线，AI 不进 settle / sign / 钱路。引用的两条裂缝都已修：settler 9-13 F2 落链才 completed（`bettor-prediction-settler.js:200-203`）；exchange-machine 现走 `evaluateKaspaPaymentGate`（:829），短路已删。NO-TX-NO-STATE 靠确定性落链核实，不靠模型。
  - **#3 并入 #1**：D-032 方向是一题一确定性源，运行时多源自动筛与之相反；建题时给运营者当选源参谋可以，结论仍是一题一源。
  - **本地自建 Jev（第三版）不现在做**：D-030 已定托管、key 已配并实测；PoC 输入是公开 / 合成题面，不触 D-021 数据边界；本机 llama-server 在服务老系统 broker，不加负载。记 SHOULD 票，触发条件 = 托管因数据边界或费用挡住真实用例。**不要去验 llama.cpp logprobs。**
- **PoC #1 规格**（零主链、零钱路、零 console）：
  1. 复用 `kasia-console/scripts/prevet-fp-fn-fixtures.mjs` 的 120 条 fixture（4 类 × 30，expected pass / warn / critical）——D-031，不新造样本。
  2. 离线脚本放 `scratch/`（不入 src）：对每条 fixture 的题面（title / resolution_criteria / data_source_canonical / 截止）问一个 noul：「该题能否从所列来源在截止后被确定性地判出唯一答案」；托管 `jev-latest`。不调 :3200 / :3202 任何接口。
  3. 输出：阈值 0.30 / 0.50 / 0.70 各一行 FP / FN（expected=pass 视为应通过、critical 视为应拒、warn 单列）；总 token 用量；每条 fixture 的 noul 值存 csv 附上。
  4. 另自造 10 条"D-032 型"坏题（题面清晰但来源判不出：非结构化来源、无阈值、无取值时刻、缺平局规则），看 noul 是否被压低——这是我们真正要挡的形状。
  5. 交付：`docs/provenance/<日期>-j1-typesafe-prevet-poc/README.md`（数字表 + 命令行 + 版本），走 coord 侧分支；我核后决定是否进 D-032 设计稿的"建题预审"节。
- **边界**：不改 src；不碰 proto_* / pool_* 表；API key 名 `TYPESAFE_API_KEY`，值不入任何文件；真实市场、余额、内网不发给托管服务。
- **排序**：不抢主线（J2 F1 对抗重跑、D-032 设计）；你手头 dotk / 金库线优先级不变，此件插空做。

— Bettor（会话 claude-90）
