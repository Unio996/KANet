# NWT diff verdict — commit 51e17c6b(kanet-start.sh 误杀 supervisor 修复落码)(2026-07-17)

> **Status**: CURRENT
> **对象**: `51e17c6b`(kanet-start.sh, 已核过的设计 5781d7a9 → 我 GREEN 5e0896bb 之后落码)
> **verdict**: **✅ GREEN — 忠实落码, 与设计逐行对得上, 可排下个重启窗装载**

## 独立复核(不是"设计已 GREEN 所以代码肯定对", 自己重新跑了三项)

- **`bash -n kanet-start.sh`**: 自己跑了一遍(不是信 commit message 说"过"), exit 0, 语法干净。
- **`grep -c "console-supervisor" kanet-start.sh`**: 自己跑了一遍, 结果 `5`, 跟 KANet-UI 报的数字一致, 不是抄的。
- **`continue` 位置逐行读**(`kanet-start.sh:54-71`): 精确核对现在落地的代码, `if [ "$name" = "console-supervisor" ]; then continue; fi` 在第 62 行, `pid=$(cat...)`(63)/`kill -0`(64-69)/**`rm -f "$pidfile"`(70)全部在 continue 之后**——设计阶段要求的"continue 必须连 rm -f 也跳过"这条, 落码时位置精确对上, 没有在誊写过程中挪错行。

## 与设计稿(5781d7a9)逐处比对
- (a) 治本片段: 逐字符核对与设计稿展示的目标代码一致(唯一差异是设计稿用 `...` 省略了后半段循环体, 落码版本是完整代码, 语义上完全吻合)。
- (b) 双保险片段: `bash "$KANET_ROOT/scripts/kanet-console-supervisor.sh" start >> "$LOG_DIR/console-supervisor.log" 2>&1 || true`, 位置在脚本收尾"状态摘要"之前, 逐字符匹配设计稿, 插入点在所有服务启动逻辑之后, 符合"最后再确认一次"的设计意图。
- 未发现 diff 范围超出设计声明(没有夹带无关改动)。

## Verdict

**GREEN。** 设计阶段核过的两个重点(匹配精度/跟 boot-sequence 修复的关系)结论不变, 这次落码本身没有引入新偏差, `continue` 精确跳过 `rm -f` 这个我在设计阶段特别关注的细节在真实代码里核实无误。可以按计划排下个 console 重启窗跟 H2 一起装载, 不需要再单开验证。

— NWT 2026-07-17
