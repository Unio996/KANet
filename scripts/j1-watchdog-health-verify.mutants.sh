#!/bin/sh
# 对 j1-watchdog-health-verify.sh 的变异测试。
# 🔴 头一条就是【把 Codex 点的那个洞原样装回去】: 不读 rc / 不读新鲜度, 只看注册态。
#    用例名字必须是红的那条 —— 装回旧行为, "fresh rc=2" 那几行就得自己红。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
S=$SELF_DIR/j1-watchdog-health-verify.sh
T=$SELF_DIR/j1-watchdog-health-verify.test.sh
TMP=$(mktemp -t wd-hv-mut.XXXXXX.sh)
det=0; miss=0; inert=0

mut() { # name  sed-expr
  sed "$2" "$S" > "$TMP"
  if cmp -s "$S" "$TMP"; then
    inert=$((inert+1)); printf '[INERT ] %-38s 变异没改动文件 —— 这条什么也没测\n' "$1"; return
  fi
  if J1_HEALTH_UNDER_TEST="$TMP" sh "$T" >/dev/null 2>&1; then
    miss=$((miss+1)); printf '[MISSED] %-38s 守卫被拆掉而用例【全绿】\n' "$1"
  else
    det=$((det+1)); printf '[detect] %-38s\n' "$1"
  fi
}

echo "--- mutation: j1-watchdog-health-verify.sh ---"
mut "退回"只验注册态"(Codex 那个洞)"  's/^if \[ -z "\$J1_HV_ALIVE" \]; then/exit 0\nif [ -z "$J1_HV_ALIVE" ]; then/'
mut "不判哨兵 rc"                     's/if \[ "\$rc" -ne 0 \]; then/if [ "$rc" -ne 999999 ]; then/'
mut "不判新鲜度上界"                  's/if \[ "\$age" -gt "\$MAX_AGE" \]; then/if [ "$age" -gt 99999999 ]; then/'
mut "上界 -gt → -ge (边界)"           's/\[ "\$age" -gt "\$MAX_AGE" \]/[ "$age" -ge "$MAX_AGE" ]/'
mut "不判未来时间戳"                  's/if \[ "\$age" -lt "\$MIN_AGE" \]; then/if [ "$age" -lt -99999999 ]; then/'
mut "Disabled 也放行"                 's/^  Disabled)/  __never_disabled__)/'
mut "不认识的状态也放行"              's/^  Ready|Running) ;;/  *) ;;/'
# 判据行加了 `&& != 1` 之后, 旧的那条 sed 不再匹配 —— 它当场变 INERT 而不是悄悄"通过"。
# 🔨 这正是单列 INERT 一类的用处: **变异表会随被测代码漂移, 而漂移后的默认表现是"看起来仍在测"。**
mut "不判 LastTaskResult"             's/-ne 0 \] \&\& \[ "\$J1_HV_LAST_RESULT" -ne 1 \]/-ne 999998 ] \&\& [ "$J1_HV_LAST_RESULT" -ne 999999 ]/'
mut "缺 .alive 当健康"                's/^  echo "🔴 注册了但【从未跑成过】.*$/  exit 0/'
# 🔴 这一条原先写成一个 sed 里带 \n 的表达式 —— 它改不动文件, 于是被记为 INERT。
#    留着这行注释, 因为"变异改不动文件"会伪装成"已检出", 是我特意单列 INERT 那一类的原因。
mut "rc 整数判据被短路 (n=\$rc → n=0)"  's/^n=\$rc$/n=0/'
mut "间隔上界放大 10 倍"              's/^MAX_AGE=.*/MAX_AGE=$(( INTERVAL * 60 * 20 + 120 ))/'
# ── Codex 2026-08-10 第三轮点的那格: 新鲜度那把尺【自己的出处】 ──────────────
mut "不验间隔来源(任何来源都放行)"    's/^  trigger) ;;/  *) ;;\n  trigger) ;;/'
mut "test 来源不要求显式认领"         's/if \[ "\${J1_HV_UNSAFE_TEST:-}" != "1" \]; then/if [ "x" = "y" ]; then/'
mut "间隔不验域(0\/负\/超大都放行)"    's/if \[ "\$INTERVAL" -lt 1 \] || \[ "\$INTERVAL" -gt 1440 \]; then/if [ "$INTERVAL" -lt -99999 ]; then/'
mut "间隔上限 1440 → 99999"           's/-gt 1440 \]/-gt 99999 ]/'
mut "间隔非整数判据被短路"            's/^n=\$INTERVAL$/n=0/'

# ── alert= 那一格(Codex 第三轮) ──────────────────────────────────────────
mut "不判 alert(送不出去也放行)"     's/-ne 0 \] \&\& \[ "\$arc" -ne 3 \]/-ne 999 ] \&\& [ "$arc" -ne 998 ]/'
mut "alert 非整数判据被短路"         's/^  n=$arc$/  n=0/'
mut "限流(3) 也当告警失败"           's/-ne 3 ]; then/-ne 33 ]; then/'
mut "alert 判据整段不生效"            's/^if \[ -n "\$arc" \]; then/if [ -n "__never__" ]; then/'

echo ""
echo "detected=$det  MISSED=$miss  INERT=$inert"
[ "$miss" = "0" ] && [ "$inert" = "0" ] || exit 1
