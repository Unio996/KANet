#!/bin/sh
# launcher 权威层负测 v3 — 修 Bettor (450) 必修1(深度伪影)+必修2(自指残洞如实标注)
#
# 🔴 上一版(v2)的错(在册 control-arm-known-answer-must-not-equal-failure-output):
#   副本放两级深(scratch/.tmp/X.sh)⇒ launcher 里 `cd dirname/..` 落 scratch/ 非仓根 ⇒ $0 相对路径解析失败 ⇒ 拒。
#   期望信号"拒"与路径伪影"拒"同形 ⇒ L-1/2/3 零判别力。Bettor repro: 未改字节副本@同深度一样被拒。
# ⇒ v3 两条修: ①副本一律放【一级】深(scratch/X.sh, cd .. 落仓根) ②加【同深度未改字节阳性对照】,
#   它必须【穿透到仪器】(内层拒 cap=999), 证明"拒"来自字节检不是路径。
#
# 跑法(树净且 HEAD==被测状态): bash scripts/j1-launcher-authority.test.sh
cd "$(dirname "$0")/.." || exit 1
HEADC=$(git rev-parse HEAD)
CANON=scripts/j1-trough-probe-launch.sh
PASS=0; FAIL=0
mkdir -p scratch
run() { # $1=名 $2=脚本路径 $3=期望串 $4=不期望串(可空)
  OUT=$(J1_PROBE_APPROVED_COMMIT=$HEADC J1_PROBE_RELAY_ID=102cbb99-test sh "$2" 999 1 2>&1)
  if echo "$OUT" | grep -q "$3" && { [ -z "$4" ] || ! echo "$OUT" | grep -q "$4"; }; then
    PASS=$((PASS+1)); echo "  ✅ $1"
  else FAIL=$((FAIL+1)); echo "  ❌ $1 — got: $(echo "$OUT" | head -1)"; fi
}

# ── 阳性对照 A: canonical(一级=仓根) 全检穿透到仪器(内层拒 cap) ──
run "PC-A canonical 穿透到被钉仪器(内层 INSTRUMENT-REFUSED cap)" "$CANON" "INSTRUMENT-REFUSED: TIME_CAP" "LAUNCH-REFUSED"

# ── 🔴 阳性对照 B(Bettor 必修1 核心): 同【一级】深度、未改字节的副本, 也必须穿透 ──
#    若它被 LAUNCH-REFUSED, 说明"拒"来自路径/深度而非字节检 ⇒ 整套负测判别力存疑。
cp "$CANON" scratch/pc-b-unchanged.sh
run "PC-B 同深度未改字节副本【也穿透】(证'拒'来自字节非路径)" scratch/pc-b-unchanged.sh "INSTRUMENT-REFUSED: TIME_CAP" "LAUNCH-REFUSED"

# ── 变异(一级深, 只改字节): 自绑字节检必须逮住 ──
sed 's/102cbb99\*) : ;;/*) : ;;/' "$CANON" > scratch/m1-relaygate.sh
run "M-1 拆 relay 前缀闸 ⇒ 启动器字节!=批准(LAUNCH-REFUSED)" scratch/m1-relaygate.sh "LAUNCH-REFUSED: 启动器磁盘字节"
sed 's/qzcpypywd2zjgx333qkr66dh6jfguyjkscy7wxqtqqvq5hchkpstg8t9gqk3v/qattackerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/' "$CANON" > scratch/m2-addr.sh
run "M-2 换发送地址 ⇒ 启动器字节!=批准(LAUNCH-REFUSED)" scratch/m2-addr.sh "LAUNCH-REFUSED: 启动器磁盘字节"

# ── 🔴 M-4 自指残洞(Bettor 必修2): 删掉自绑块本身 + 换地址 ⇒ launcher 内【关不掉】, 直穿仪器 ──
#    这一格【期望穿透】(不是被拒)——它证明的是"残洞存在", 闭合在信任域【外】(见下方规程)。
sed -e '/SELF_DISK=\$(git hash-object "\$0")/d' -e '/SELF_HEAD=\$(git rev-parse/d' -e '/启动器磁盘字节 != 批准 commit 版本/d' \
    -e 's/qzcpypywd2zjgx333qkr66dh6jfguyjkscy7wxqtqqvq5hchkpstg8t9gqk3v/qattackerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/' "$CANON" > scratch/m4-selfremove.sh
run "M-4 删自绑块+换地址【穿透=残洞坐实】(out-of-scope-external-closure)" scratch/m4-selfremove.sh "INSTRUMENT-REFUSED: TIME_CAP" "LAUNCH-REFUSED"

rm -f scratch/pc-b-unchanged.sh scratch/m1-relaygate.sh scratch/m2-addr.sh scratch/m4-selfremove.sh
echo "launcher-authority v3: $PASS PASS / $FAIL FAIL"
echo "🔴 M-4 穿透=已知残洞: launcher 自指-guard 内部关不掉。外域闭合(规程强制): 执行方跑前独立"
echo "   'git hash-object $CANON' 比对 Codex ACCEPT 记录的批准 blob, 且只跑 canonical 路径。"
[ "$FAIL" = 0 ] || exit 1
