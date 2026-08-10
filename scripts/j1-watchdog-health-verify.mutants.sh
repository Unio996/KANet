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
mut "不判 LastTaskResult"             's/if \[ "\$J1_HV_LAST_RESULT" -ne 0 \]; then/if [ "$J1_HV_LAST_RESULT" -ne 999999 ]; then/'
mut "缺 .alive 当健康"                's/^  echo "🔴 注册了但【从未跑成过】.*$/  exit 0/'
# 🔴 这一条原先写成一个 sed 里带 \n 的表达式 —— 它改不动文件, 于是被记为 INERT。
#    留着这行注释, 因为"变异改不动文件"会伪装成"已检出", 是我特意单列 INERT 那一类的原因。
mut "rc 整数判据被短路 (n=\$rc → n=0)"  's/^n=\$rc$/n=0/'
mut "间隔上界放大 10 倍"              's/^MAX_AGE=.*/MAX_AGE=$(( INTERVAL * 60 * 20 + 120 ))/'

echo ""
echo "detected=$det  MISSED=$miss  INERT=$inert"
[ "$miss" = "0" ] && [ "$inert" = "0" ] || exit 1
