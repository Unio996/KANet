#!/bin/sh
# 对 j1-watchdog-alert.sh 的变异测试。
# 🔴 重点在【方向】: "该发不发"(永久静音)比"不该发也发"(吵)严重得多,
#    所以把倾向反过来的变异必须能红 —— 否则用例只在数值上守, 没在方向上守。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
S=$SELF_DIR/j1-watchdog-alert.sh
T=$SELF_DIR/j1-watchdog-alert.test.sh
TMP=$(mktemp -t j1alert-mut.XXXXXX.sh)
det=0; miss=0; inert=0

mut() {
  sed "$2" "$S" > "$TMP"
  if cmp -s "$S" "$TMP"; then
    inert=$((inert+1)); printf '[INERT ] %-40s 变异没改动文件\n' "$1"; return
  fi
  if J1_ALERT_UNDER_TEST="$TMP" sh "$T" >/dev/null 2>&1; then
    miss=$((miss+1)); printf '[MISSED] %-40s 守卫被拆掉而用例【全绿】\n' "$1"
  else
    det=$((det+1)); printf '[detect] %-40s\n' "$1"
  fi
}

echo "--- mutation: j1-watchdog-alert.sh ---"
mut "限流边界 -lt → -le"              's/\[ "\$age" -lt "\$MIN" \]/[ "$age" -le "$MIN" ]/'
mut "限流窗放大 100 倍"               's/^MIN=\${J1_ALERT_MIN_SEC:-3600}/MIN=${J1_ALERT_MIN_SEC:-360000}/'
mut "🔴 坏状态当【刚发过】(永久静音)"  's/last=0 ;; esac/last=$NOW ;; esac/'
mut "🔴 去掉 age>=0 判断(时钟倒退静音)" 's/ \&\& \[ "\$age" -ge 0 \]//'
mut "完全不限流(每次都发)"            's/^if \[ "\$last" -ne 0 \]/if [ "$last" -ne 0 ] \&\& false/'
mut "永远限流(什么都不发)"            's/^if \[ "\$last" -ne 0 \]/if true \&\& [ 1 = 1 ] ; then echo "ALERT-THROTTLED forced"; exit 0; fi\nif [ "$last" -ne 0 ]/'
mut "空内容也发"                      's/\[ -z "\$BODY" \]/[ -z "__never__" ]/'
mut "payload 不带响声原文"            's/^  body,$/  "",/'
mut "payload 不带 rc"                 's/"rc=" + process.env.J1_A_RC/""/'

# ── Codex 2026-08-10 判 RED 的那格: 失败必须【非零退出】, 不能只留一行日志 ──
mut "🔴 发送失败吞成 exit 0"              "s/^exit 1$/exit 0/"
mut "限流退码 3 → 0 (不可分辨)"          "s/^  exit 3$/  exit 0/"
mut "应答校验: 只要含 txId 就算成功"      "s/okFlag && typeof tx/true && typeof tx/"
mut "应答校验: txid 不验形状"             's#\.test(tx)#.length > 0 \&\& true#'
# 🔴 这里原本有一条「不看 curl 退码」的变异, **它当时 MISSED** —— 拆掉那道 `if [ "$crc" -eq 0 ]`
#    全部用例照样绿, 因为 curl 失败时 $out 是错误文本, 过不了应答校验。
#    ⇒ 处理方式不是"给它补个用例", 是**把那道冗余守卫删掉**: 冗余 + 没有用例守得住 = 负债,
#      它会让读代码的人以为多了一道防线。变异测试在这里的作用是**指出一段代码不承重**。
mut "构造失败也继续(拆掉 exit)"           's/; exit 1; }/; exit 0; }/'

echo ""
echo "detected=$det  MISSED=$miss  INERT=$inert"
[ "$miss" = "0" ] && [ "$inert" = "0" ] || exit 1
