#!/bin/sh
# 对 j1-watchdog-sentinel-once.sh 的变异测试。
#
# 🔴 存在理由: 2026-08-10 我在 watchdog 那支上连续【五次】写出跑绿但什么也不守的用例
#    (mut3/mut4/mut9/mut13/part5 各一次)。绿不是证据, 【把守卫拆掉能看见它红】才是。
# 🔴 每个变异必须【真的改变了文件】—— 改不动的变异会伪装成"已检出"。
S=/d/kanet/kanet/scripts/j1-watchdog-sentinel-once.sh
T=/d/kanet/kanet/scripts/j1-watchdog-sentinel.test.sh
TMP=/d/kanet/kanet/scratch/wd-sent-mut.sh
det=0; miss=0; inert=0

mut() { # name  sed-expr
  sed "$2" "$S" > "$TMP"
  if cmp -s "$S" "$TMP"; then
    inert=$((inert+1)); printf '[INERT ] %-30s 变异没改动文件 —— 这条什么也没测\n' "$1"; return
  fi
  if sed "s#^S=.*#S=$TMP#" "$T" | sh >/dev/null 2>&1; then
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
mut "删掉非整数心跳判据"          's/'"'"''"'"'|\*\[!0-9-\]\*|-|'"'"'-'"'"'/__never_match__/'
mut "取不到 exit 2 → exit 0"     's/^    exit 2/    exit 0/'
mut "取不到 exit 2 → exit 1"     's/^    exit 2/    exit 1/'
mut "任何输入都当合法读数"        's/^  WD=\*) ;;/  *) ;;/'
mut "故障 exit 1 → exit 0 (全部)" 's/^  exit 1$/  exit 0/'

echo ""
echo "detected=$det  MISSED=$miss  INERT=$inert"
[ "$miss" = "0" ] && [ "$inert" = "0" ] || exit 1
