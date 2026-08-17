#!/bin/sh
# launcher 权威层负测(Codex LAUNCHER-AUTHORITY 复审点名): 只变异 launcher(仪器/发送器/绑定模块字节不动),
# 运行必须被结构性拒绝。阳性对照用 TIME_CAP=999 证明"通过 launch 检查后到达了被钉仪器"(仪器拒 cap, 零运行成本)。
# 跑法: bash scripts/j1-launcher-authority.test.sh   (树净且 HEAD 即被测状态)
cd "$(dirname "$0")/.." || exit 1
HEADC=$(git rev-parse HEAD)
TMP=scratch/.launcher-authority-test-$
mkdir -p "$TMP"   # 🔴 副本放仓库【内】: cd 能解析回仓库根 ⇒ 触发的是 $0 字节检(目标防线), 不是 cd 失败的副作用
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
run_case() { # $1=名 $2=launcher路径 $3=期望串
  OUT=$(J1_PROBE_APPROVED_COMMIT=$HEADC J1_PROBE_RELAY_ID=102cbb99-test sh "$2" 999 1 2>&1)
  if echo "$OUT" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1 — got: $OUT"; fi
}
# L-0 阳性对照: 规范 launcher 全检通过并到达仪器(仪器拒非法 cap = 证明穿透到内层)
run_case "L-0 阳性对照(到达被钉仪器, 内层拒 cap=999)" scripts/j1-trough-probe-launch.sh "INSTRUMENT-REFUSED: TIME_CAP"
# L-1 变异: relay 前缀闸拆除
sed 's/102cbb99\*) : ;;/*) : ;;/' scripts/j1-trough-probe-launch.sh > "$TMP/m1.sh"
run_case "L-1 拆 relay 前缀闸的副本 ⇒ 拒" "$TMP/m1.sh" "LAUNCH-REFUSED"
# L-2 变异: 换 host profile(发送地址)
sed 's/qzcpypywd2zjgx333qkr66dh6jfguyjkscy7wxqtqqvq5hchkpstg8t9gqk3v/qattackerattackerattackerattackerattackerattackerattackerattack/' scripts/j1-trough-probe-launch.sh > "$TMP/m2.sh"
run_case "L-2 换发送地址的副本 ⇒ 拒" "$TMP/m2.sh" "LAUNCH-REFUSED"
# L-3 变异: 拆 HEAD==approved 检查
sed 's/if \[ -z "\$APPR" \] || \[ "\$HEADC" != "\$APPR" \]; then/if false; then/' scripts/j1-trough-probe-launch.sh > "$TMP/m3.sh"
run_case "L-3 拆 approved-commit 检查的副本 ⇒ 拒" "$TMP/m3.sh" "LAUNCH-REFUSED"
echo "launcher-authority: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = 0 ] || exit 1
