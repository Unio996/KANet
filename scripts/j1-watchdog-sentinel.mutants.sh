#!/bin/sh
# 对 j1-watchdog-sentinel-once.sh 的变异测试。
#
# 🔴 存在理由: 2026-08-10 我在 watchdog 那支上连续【五次】写出跑绿但什么也不守的用例
#    (mut3/mut4/mut9/mut13/part5 各一次)。绿不是证据, 【把守卫拆掉能看见它红】才是。
# 🔴 每个变异必须【真的改变了文件】—— 改不动的变异会伪装成"已检出"。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
S=$SELF_DIR/j1-watchdog-sentinel-once.sh
T=$SELF_DIR/j1-watchdog-sentinel.test.sh
TMP=$(mktemp -t wd-sent-mut.XXXXXX.sh)
det=0; miss=0; inert=0; broken=0

mut() { # name  sed-expr
  sed "$2" "$S" > "$TMP"
  if cmp -s "$S" "$TMP"; then
    inert=$((inert+1)); printf '[INERT ] %-30s 变异没改动文件 —— 这条什么也没测\n' "$1"; return
  fi
  # 🔴 还要分出第三类: **改成了语法坏的**。
  #    2026-08-10 我写坏一条 sed(表达式被 shell 吃掉), 它把文件改残了 ⇒ 用例当然全红
  #    ⇒ 被记成 [detect]。**而它证明的不是守卫被拆掉, 是文件被毁了。**
  #    INERT 只分"改没改动", 分不出"改坏了" —— 坏文件【必然】检出, 是个假阳性。
  if ! sh -n "$TMP" 2>/dev/null; then
    broken=$((broken+1)); printf '[BROKEN] %-30s 变异体语法就是坏的 —— 它必然"检出", 什么也没证\n' "$1"; return
  fi
  # 用【用例文件自己提供的注入口】指向变异体, 不再 sed 改写它的 S= 行 ——
  # 改写等于每次都在测一个"被我编辑过的用例文件", 而我要测的是【提交进库的那一份】。
  if J1_SENTINEL_UNDER_TEST="$TMP" sh "$T" >/dev/null 2>&1; then
    miss=$((miss+1)); printf '[MISSED] %-30s 守卫被拆掉而用例【全绿】\n' "$1"
  else
    det=$((det+1)); printf '[detect] %-30s\n' "$1"
  fi
}

echo "--- mutation: j1-watchdog-sentinel-once.sh ---"
mut "上界 -gt → -ge (边界)"      's/-gt "\$HB_MAX"/-ge "$HB_MAX"/'
mut "上界阈值 300000 → 999999"   's/^HB_MAX=300000/HB_MAX=999999/'
mut "删掉下界(未来时间戳)"        's/-lt "\$HB_MIN"/-lt -999999999/'
mut "下界阈值 -60000 → -1"        's/^HB_MIN=-60000/HB_MIN=-1/'
mut "WD 判据 != 1 → -gt 1"       's/\[ "\$WD" != "1" \]/[ "$WD" -gt "1" ]/'
mut "删掉 MINER 判据"             's/\[ "\$MN" != "1" \]/[ "$MN" = "__never__" ]/'
mut "删掉非整数心跳判据"          "s/''|\\*\\[!0-9\\]\\*)/__never_match__)/"
# 🔴 这一条是【把 @KANet-UI 打穿的那个缺陷原样装回去】—— 判据从"整数的定义"退回"它通常长什么样"。
#    用例名字必须是红的那条: 装回旧字符类, 1-2/--5/5- 那几行就得自己红。
mut "退回旧字符类 [!0-9-] (KUI缺陷)" 's/\*\[!0-9\]\*/*[!0-9-]*/'
mut "负号剥成剥光(tr -d)"          "s|case \"\$n\" in -\\*) n=\\\${n#-} ;; esac|n=\$(printf '%s' \"\$n\" \| tr -d '\\\\055')|"
mut "根本不剥负号"                 's|case "$n" in -\*) n=${n#-} ;; esac|:|'
mut "取不到 exit 2 → exit 0"     's/^    exit 2/    exit 0/'
mut "取不到 exit 2 → exit 1"     's/^    exit 2/    exit 1/'
mut "任何输入都当合法读数"        's/^  WD=\*) ;;/  *) ;;/'
mut "故障 exit 1 → exit 0 (全部)" 's/^  exit 1$/  exit 0/'

# ── 刹车豁免那一格(新加的【静默口】, 必须能被拆红) ──────────────────────
mut "unknown 也当成在刹车(静音真死)" 's/\" != "yes"/\" = "__never__"/'
mut "任何刹车状态都静默"            's/\" = "no"/\" = "__never__"/'
mut "刹车豁免提前到心跳之前"        's/^# 心跳都过了/exit 0\n# 心跳都过了/'
mut "HB 正则退回贪婪(吞掉 BRAKE)"    's/\[^ \]/[^Z]/'

echo ""
echo "detected=$det  MISSED=$miss  INERT=$inert  BROKEN=$broken"
[ "$miss" = "0" ] && [ "$inert" = "0" ] && [ "$broken" = "0" ] || exit 1
