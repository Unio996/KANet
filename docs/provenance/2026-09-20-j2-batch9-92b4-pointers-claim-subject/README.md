# 9-2b (iii-2) 前置修正：指针模块 convert_to_claim 意图的主体（9-1 D 笔遗留的接线缺陷）

- **缺陷**：`settlementIntentKeyFor` 的 `STEP_SUBJECT_TYPE` 把 `convert_to_claim` / `claim_draw` 归在 **claim** 主体下（设计 §4 同），但指针模块 `landedSettlement(db, marketId, "convert_to_claim")` 按 `(subject_type=market, subject_id=marketId)` 找它 ⇒ 生产里造不出这样的键 ⇒ claim_draw 步骤的指针**永远解析不出**（`pointer_dependency_not_landed`）。9-1 的指针测试夹具把 convert 意图直接插成 market 主体（违反意图模块自己的配对规则），所以自己的测试看不见。
- **怎么发现的**：9-2b (iii-2) 的离线端到端（真 builder 链 + 真 store / 指针 / C1 / 核心 + 假链）跑到 claim_draw 时报 `pointer_dependency_not_landed`。
- **修**：先按 market 找赢 claim 行，再按 `("claim", claimId)` 找 convert_to_claim 意图；指针测试夹具改成 claim 行 + claim 主体意图键。
- 测试末行：pointers 27/0；变异（把查找改回 market 主体）⇒ 13 passed 14 failed（红）；lint 见 lint.txt。
