function Say($m) { [Console]::WriteLine($m) }

$ErrorActionPreference = 'Stop'
$path = if ($env:WD_PATH) { $env:WD_PATH } else { Join-Path $PSScriptRoot 'tn12-mining-watchdog-v2.ps1' }
$lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)

$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*if \(\$pulseHalted\) \{') { $start = $i; break } }
if ($start -lt 0) { throw 'FIXTURE-BROKEN: cannot find the start of the pulse decision chain' }

# depth returns to 0 after EACH block of an if/elseif/else chain, so closing once is not the end:
# keep going while the following non-blank line continues the chain.
$depth = 0; $end = -1
for ($i = $start; $i -lt $lines.Count; $i++) {
  $l = $lines[$i]
  $code = if ($l -match '^\s*#') { '' } else { $l }
  $depth += ([regex]::Matches($code, '\{')).Count
  $depth -= ([regex]::Matches($code, '\}')).Count
  if ($depth -le 0 -and $i -gt $start) {
    $j = $i + 1
    while ($j -lt $lines.Count -and $lines[$j].Trim() -eq '') { $j++ }
    if ($j -lt $lines.Count -and $lines[$j] -match '^\s*(\}\s*)?(elseif|else)\b') { continue }
    $end = $i; break
  }
}
if ($end -lt 0) { throw 'FIXTURE-BROKEN: chain never closed' }
$chain = ($lines[$start..$end] -join "`n")
$branches = ([regex]::Matches($chain, '(?m)^\s*(elseif|else)\b')).Count + 1
Say ("extracted lines {0}-{1} ({2} lines, {3} branches)" -f ($start+1), ($end+1), ($end-$start+1), $branches)
# 锚点故意【不是】分支数: 分支数每改一次结构就要跟着改一次, 而一个需要被维护的守卫最后总会被
# 改成"让它别叫"。改锚在【链的最后一支里那个动作本身】—— 抽早了它就不在, 而它不是任何一条用例
# 在检验的性质(同 part 2 那条教训: fixture 只许锚在它不测的东西上)。
if ($chain -notmatch 'Start-Sleep -Seconds \$PULSE_SEC') { throw 'FIXTURE-BROKEN: extraction stopped before the pulse action -- the test would silently cover a fragment' }
if ($chain -notmatch 'Stop-Miner') { throw 'FIXTURE-BROKEN: extracted chain has no Stop-Miner -- not the braked branch' }
Say ''

$stubs = @'
function Start-Miner-Unless-Paused { $global:STARTED++ }
function Stop-Miner { $global:STOPPED++ }
function Start-Sleep { param($Seconds) $global:SLEPT += $Seconds }
function Alert($m) { $global:ALERTS += @($m) }
function Log($m)   { $global:LOGS   += @($m) }
# part 1 隔离的是【tips 效力那一格】, 所以这里让每一发都付账(DAA 前进), 好让 DAA 那道闸不参与判定。
# DAA 闸本身归 part 3 —— 它是跨轮的, part 1 这种单轮注入结构上够不到(这正是 Codex 指出的那点)。
function Get-DaaNow { return [uint64]($global:SIM_DAA + 5) }
'@

$script:pass = 0; $script:fail = 0
function Run-Case($name, $halted, $adv, $count, $tips, $refTips, $expPulsed, $expHalted) {
  $global:STARTED = 0; $global:STOPPED = 0; $global:SLEPT = 0
  $global:ALERTS = @(); $global:LOGS = @()
  $pulseHalted = $halted; $daaAdvancing = $adv; $pulseCount = $count
  $pulseRefTips = $refTips; $MAX_PULSES = 20; $PULSE_CHECK = 5
  $PULSE_SEC = 20; $TIPS_RESUME = 50; $round = 20; $prevDaa = 123456
  $global:SIM_DAA = 1000; $daaNow = [uint64]1000
  . ([scriptblock]::Create($stubs + "`n" + $chain))
  $pulsed = ($global:STARTED -gt 0)
  $ok = ($pulsed -eq $expPulsed) -and ($pulseHalted -eq $expHalted)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Say ("[{0}] {1,-32} pulsed={2,-5} halted={3,-5} slept={4} alerts={5}" -f $mark, $name, $pulsed, $pulseHalted, $global:SLEPT, $global:ALERTS.Count)
  if (-not $ok) { Say ("       expected pulsed={0} halted={1}" -f $expPulsed, $expHalted) }
  if ($global:ALERTS.Count) { Say ("       alert: " + $global:ALERTS[0].Substring(0, [Math]::Min(84, $global:ALERTS[0].Length))) }
}

Run-Case 'already halted -> no pulse'     $true  $true   3 150 200 $false $true
# 🔴 这里原本有两条前置 DAA 用例(unknown -> 不脉冲 / flat -> 抑制)。它们随 2026-08-10 的改写【消失了】,
#    因为那两个判定从"脉冲前看上一轮"挪到了"脉冲后看这一发", 而这一挪正是 Codex 那条 MUST-FIX 的内容。
#    删掉而不是留着改绿: 一条名字还在、检验的东西已经没了的用例, 比没有用例更坏。
#    等价覆盖在 part 3(wedged from the start / DAA unreadable), 而且那里才测得到跨轮的那一半。
Run-Case 'budget exhausted -> halt'       $false $true  20 150 200 $false $true
Run-Case 'normal -> pulse'                $false $true   1 150 200 $true  $false
Run-Case 'checkpoint, tips NOT down'      $false $true   4 210 200 $true  $true
# 边界: tips 与参考值【相等】。变异测试(-ge 改 -gt)证明前一条用例【测不到这个】——
# 210>200 时 -gt 也拦得住, 于是那条用例的名字("没降就停")覆盖不了它自称覆盖的一半。
# "没有下降" 包含 "持平", 而持平正是脉冲无效最典型的样子(2026-08-09 楔死那次就是纹丝不动)。
Run-Case 'checkpoint, tips FLAT (== ref)' $false $true   4 200 200 $true  $true
Run-Case 'checkpoint, tips down -> go on' $false $true   4 150 200 $true  $false

Say ''
Say '--- part 2: the DAA three-state derivation (mutation testing showed part 1 never reaches it) ---'
# 变异④(把 UNKNOWN 塌成 $true)在 part 1 下【全绿】, 因为那些用例直接给 $daaAdvancing 赋值,
# 从不执行推导它的那几行 ⇒ 承重的 [uint64] 强转和三态判定当时零覆盖。
# 同样抽文件里的真字节, 不重实现。
$ds = -1; $de = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*\$daaNow = \$null\s*$') { $ds = $i; break } }
if ($ds -lt 0) { throw 'FIXTURE-BROKEN: cannot find the DAA derivation block' }
for ($i = $ds; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*if \(\$null -ne \$daaNow\) \{ \$prevDaa = \$daaNow \}') { $de = $i; break } }
if ($de -lt 0) { throw 'FIXTURE-BROKEN: DAA derivation block has no end' }
$deriv = ($lines[$ds..$de] -join "`n")
# 🔴 锚点【故意】不是 [uint64]。原先这里断言 "必须含 [uint64]" —— 那等于让 fixture 去断言
#    用例本身存在的理由, 于是拆掉强转时是 fixture 先炸, 而不是那条以它命名的用例变红,
#    真正的失败信号被一条更早的断言盖住了。
#    ⇒ 通则: fixture 只许锚在【它不测的东西】上。这里锚 $daaAdvancing(结构标识),
#    强转在不在, 交给下面 "lexicographic trap" 那两条用例去说。
if ($deriv -notmatch '\$daaAdvancing') { throw 'FIXTURE-BROKEN: extracted block is not the DAA derivation' }
Say ("extracted lines {0}-{1} ({2} lines)" -f ($ds+1), ($de+1), ($de-$ds+1))

function Run-Daa($name, $prev, $scoreString, $expect) {
  $health = if ($null -eq $scoreString) { [pscustomobject]@{ } } else { [pscustomobject]@{ virtualDaaScore = $scoreString } }
  $prevDaa = $prev
  $daaAdvancing = 'untouched'
  . ([scriptblock]::Create($deriv))
  $got = if ($null -eq $daaAdvancing) { 'unknown' } else { [string]$daaAdvancing }
  $ok = ($got -eq $expect)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Say ("[{0}] {1,-40} -> {2,-8} (expect {3})" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $got, $expect)
}

Run-Daa 'no previous reading -> unknown'        $null '76812253' 'unknown'
Run-Daa 'no virtualDaaScore field -> unknown'   ([uint64]100) $null 'unknown'
Run-Daa 'advanced 100 -> 101'                   ([uint64]100) '101' 'True'
Run-Daa 'flat 100 -> 100 (the wedge)'           ([uint64]100) '100' 'False'
Run-Daa 'went backwards 100 -> 99'              ([uint64]100) '99'  'False'
# 🔴 这条是全 part 2 最承重的: 字符串比较下 "9" -gt "10" 为真, 于是【楔死】会被读成【在推进】,
#    刹车照常脉冲, 而日志看起来完全正常。真实 DAA 是 8 位数, 跨位数的时刻天天都在发生。
Run-Daa 'lexicographic trap: 9 -> 10 must rise' ([uint64]9)   '10'  'True'
Run-Daa 'lexicographic trap: 99 -> 100 rises'   ([uint64]99)  '100' 'True'
Run-Daa 'garbage score -> unknown, not false'   ([uint64]100) 'abc' 'unknown'

Say ''
Say '--- part 3: multi-round loop state (Codex: parts 1 and 2 cannot see the feedback loop) ---'
# 前两部分测的是【谓词】: part 1 直接给 $daaAdvancing 赋值, part 2 单独跑推导。
# 两者都看不见 Codex 抓到的那件事 —— 那是【跨轮】的: 一发脉冲改变了下一轮读到的 DAA。
# 这里把真实的 braked 分支【连跑多轮】, 配一个只在脉冲跑过时才涨的 DAA 源, 也就是那条链本身的物理:
# 这条网络上虚拟只在有块到达时推进, 而块只在我们挖的时候到达(08-09 排空阶段实测, submittedDelta=0
# 的每一次 chainBlocks 都不动)。⇒ 这个假体不是方便, 它就是被测环境。

$multiStubs = @'
function Start-Miner-Unless-Paused { $script:pulsedThisRound = $true; $script:started++; $script:seq += @('start') }
function Stop-Miner { $script:stopped++; $script:seq += @('stop') }
function Start-Sleep {
  param([int]$Seconds, [int]$Milliseconds)
  # 两种 sleep 必须分得开: 脉冲时长走 -Seconds, 结算窗走 -Milliseconds。
  if ($Milliseconds -gt 0) { $script:seq += @("settle:$Milliseconds") } else { $script:seq += @("pulse:$Seconds") }
}
function Alert($m) { $script:alerts += @($m) }
function Log($m)   { }
function Get-DaaNow {
  $script:seq += @('read')
  if ($script:daaUnknown) { return $null }
  if ($script:pulsedThisRound -and $script:wedged -eq $false) { $script:simDaa = $script:simDaa + 5 }
  return $script:simDaa
}
'@

function Run-Rounds($name, $wedgeAfterPulse, $daaUnknown, $rounds, $expPulses, $expHaltedBy, $expAlert) {
  $script:simDaa = [uint64]1000; $script:started = 0; $script:stopped = 0; $script:alerts = @()
  $script:seq = @()
  $script:daaUnknown = $daaUnknown
  $DAA_SETTLE_MS = 1500
  $script:wedged = ($wedgeAfterPulse -eq 0)
  $pulseHalted = $false; $pulseCount = 0; $pulseRefTips = 200
  $MAX_PULSES = 20; $PULSE_CHECK = 5; $PULSE_SEC = 20; $TIPS_RESUME = 50; $round = 0
  $tips = 200
  $haltedAt = $null
  $sb = [scriptblock]::Create($multiStubs + "`n" + $chain)
  # 🔴 这里【必须】照真实循环那样每轮重算 $daaAdvancing, 哪怕新代码的闸不再读它。
  #    变异测试证明了原因: 我第一版不设它, 于是"把授权接回自证信号"那个变异体在测试里是【惰性】的
  #    —— 而那正是 Codex 抓到的原缺陷本身。假体少建模一个真实存在的变量, 就等于替被测代码
  #    挡掉了一整类重注入。
  $prevSim = $null
  for ($r = 1; $r -le $rounds; $r++) {
    $round = $r
    $script:pulsedThisRound = $false
    # 健康跑够 N 发后转楔死 —— 这是"中途由健康转楔死"那一格
    if ($wedgeAfterPulse -gt 0 -and $pulseCount -ge $wedgeAfterPulse) { $script:wedged = $true }
    $daaNow = if ($daaUnknown) { $null } else { $script:simDaa }
    $daaAdvancing = if ($null -eq $daaNow -or $null -eq $prevSim) { $null } else { ($daaNow -gt $prevSim) }
    if ($null -ne $daaNow) { $prevSim = $daaNow }
    $tips = [Math]::Max(1, 200 - $pulseCount * 12)   # 健康时 tips 随脉冲下降
    . $sb
    if ($pulseHalted -and $null -eq $haltedAt) { $haltedAt = $pulseCount }
  }
  $okPulses = ($pulseCount -eq $expPulses)
  $okHalt = ($haltedAt -eq $expHaltedBy)
  # 断言【是哪一种告警】, 不只断言"停了": 变异测试证明"读不到"与"没付账"两条路殊途同归到
  # 同样的发数与停手, 于是一条以"读不到"命名的用例, 在守卫被删掉之后照样绿。
  # 两者导出的操作动作不同(修仪器 vs 查楔死), 所以诊断本身就是要守的东西。
  $okAlert = $true
  if ($expAlert) { $okAlert = ($script:alerts.Count -gt 0 -and $script:alerts[0] -like "*$expAlert*") }
  $ok = $okPulses -and $okHalt -and $okAlert
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Say ("[{0}] {1,-40} pulses={2,-3} haltedAtPulse={3,-4} alerts={4}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $pulseCount, "$haltedAt", $script:alerts.Count)
  if (-not $ok) { Say ("       expected pulses={0} haltedAtPulse={1}" -f $expPulses, $expHaltedBy) }
  if ($script:alerts.Count) { Say ('       ' + $script:alerts[0].Substring(0, [Math]::Min(76, $script:alerts[0].Length))) }
}

# 楔死态: 第一发就不付账 ⇒ 恰好花掉【一发】然后停。这就是那条被明写为"有意接受"的风险的上界。
Run-Rounds 'wedged from the start -> 1 pulse'   0  $false 10  1  1     'DID NOT PAY FOR ITSELF'
# 健康态: 每一发都拉动 DAA ⇒ 持续脉冲, 不因自证而停也不因自证而失控
Run-Rounds 'healthy -> keeps pulsing'          99  $false  6  6  $null $null
# 中途转楔死: 健康 3 发后楔住 ⇒ 第 4 发白花, 停在 4。【转换点只赔一发】
Run-Rounds 'healthy 3 then wedges -> halts at 4' 3 $false 10  4  4     'DID NOT PAY FOR ITSELF'
# 读不到 DAA: 未知不许当成成功。断言告警是【UNKNOWN 那一条】而不只是"停了" ——
# 变异测试证明: 少了这个断言, 删掉 unknown 守卫后本条照样绿。
Run-Rounds 'DAA unreadable -> UNKNOWN halt'     99 $true  10  1  1     'PULSE OUTCOME UNKNOWN'

# 结算窗(@NWT 提的 MUST-FIX): 断言的是【顺序】—— stop 之后、read 之前必须有一段毫秒级 sleep。
# 🔴 不断言"存在一个 sleep": 常量原地不动而 sleep 被挪到别处, 保证就没了而断言照样绿。
#    也不断言具体毫秒数: 那个数按机器测(刹车那台 max 483ms vs console 那台 <=110ms, 差 4 倍),
#    把它焊进用例等于让用例在另一台机器上说谎。
$script:simDaa = [uint64]1000; $script:started = 0; $script:stopped = 0; $script:alerts = @(); $script:seq = @()
$script:daaUnknown = $false; $script:wedged = $false; $script:pulsedThisRound = $false
$pulseHalted = $false; $pulseCount = 0; $pulseRefTips = 200; $MAX_PULSES = 20; $PULSE_CHECK = 5
$PULSE_SEC = 20; $DAA_SETTLE_MS = 1500; $TIPS_RESUME = 50; $round = 1; $tips = 200
$daaNow = [uint64]1000; $daaAdvancing = $null
. ([scriptblock]::Create($multiStubs + "`n" + $chain))
$iStop = [Array]::IndexOf($script:seq, 'stop')
$iRead = [Array]::IndexOf($script:seq, 'read')
$iSettle = -1
for ($i = 0; $i -lt $script:seq.Count; $i++) { if ($script:seq[$i] -like 'settle:*') { $iSettle = $i; break } }
$ordered = ($iStop -ge 0 -and $iSettle -gt $iStop -and $iRead -gt $iSettle)
if ($ordered) { $script:pass++ } else { $script:fail++ }
Say ("[{0}] {1,-40} seq = {2}" -f $(if ($ordered) { 'PASS' } else { 'FAIL' }), 'settle window sits stop->settle->read', ($script:seq -join ' -> '))
if (-not $ordered) { Say "       expected a millisecond sleep strictly between Stop-Miner and the DAA read" }

Say ''
Say '--- part 4: settle-window override validation (Codex: the guarantee was overrideable) ---'
# 抽文件里那段真校验块来跑。这里测的是【一个安全常量能不能被 env 悄悄削掉】,
# 而不是它等于多少 —— 具体毫秒数按机器测, 焊进用例就会在别的机器上说谎。
$vs = -1; $ve = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^if \(\$DAA_SETTLE_RAW\) \{') { $vs = $i; break } }
if ($vs -lt 0) { throw 'FIXTURE-BROKEN: cannot find the settle override validation block' }
$d = 0
for ($i = $vs; $i -lt $lines.Count; $i++) {
  $c = if ($lines[$i] -match '^\s*#') { '' } else { $lines[$i] }
  $d += ([regex]::Matches($c, '\{')).Count; $d -= ([regex]::Matches($c, '\}')).Count
  if ($d -le 0 -and $i -gt $vs) { $ve = $i; break }
}
if ($ve -lt 0) { throw 'FIXTURE-BROKEN: settle validation block never closed' }
$validate = ($lines[$vs..$ve] -join "`n")
if ($validate -notmatch 'TryParse') { throw 'FIXTURE-BROKEN: extracted block is not the parser' }
# 🔴 初值那一行也必须【从文件里抽】, 不能由假体自己写。
#    变异测试第三次抓到同一个形状: 我先前在 harness 里写死 $DAA_SETTLE_MS = $DAA_SETTLE_DEFAULT_MS,
#    而 mut9 改的正是那一行 ⇒ 假体供给了它本该检验的东西, 变异体全绿。
#    "安全默认先赋值、覆盖只在校验通过后替换"这个写法本身就是守卫的一半, 所以它必须在被测范围内。
$initLine = ($lines | Where-Object { $_ -match '^\$DAA_SETTLE_MS\s+=' })
if (-not $initLine) { throw 'FIXTURE-BROKEN: cannot find the $DAA_SETTLE_MS initialisation line' }
Say ("extracted lines {0}-{1} ({2} lines) + init line" -f ($vs+1), ($ve+1), ($ve-$vs+1))

function Run-Settle($name, $raw, $expMs, $expReject) {
  $script:alerts = @(); $script:logs = @()
  $DAA_SETTLE_FLOOR_MS = 1000; $DAA_SETTLE_DEFAULT_MS = 1500; $PULSE_SEC = 20
  $DAA_SETTLE_RAW = $raw
  . ([scriptblock]::Create("function Alert(`$m){ `$script:alerts += @(`$m) }`nfunction Log(`$m){ `$script:logs += @(`$m) }`n" + $initLine + "`n" + $validate))
  $rejected = ($script:alerts.Count -gt 0)
  $ok = ($DAA_SETTLE_MS -eq $expMs) -and ($rejected -eq $expReject)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Say ("[{0}] {1,-38} raw='{2}' -> {3}ms rejected={4}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $raw, $DAA_SETTLE_MS, $rejected)
  if (-not $ok) { Say ("       expected {0}ms rejected={1}" -f $expMs, $expReject) }
}

Run-Settle 'unset -> default'              $null  1500 $false
Run-Settle 'zero -> rejected, keeps 1500'  '0'    1500 $true
Run-Settle 'negative -> rejected'          '-500' 1500 $true
Run-Settle 'malformed -> rejected'         'abc'  1500 $true
Run-Settle 'below floor (999) -> rejected' '999'  1500 $true
Run-Settle 'at floor (1000) -> accepted'   '1000' 1000 $false
Run-Settle 'above floor (3000) -> accepted' '3000' 3000 $false
# 上界。🔴 上一版这两条断言的是"接受了 + 喊了", Codex 推翻、NWT 自撤原判、Bettor 裁定采 Codex ——
# 于是【期望值本身翻了】: over-ceiling 现在必须【拒绝并回落 1500】。
# 我错在把"拒绝"与"静默钳位"当成一回事: 我反对的是【静默】, 而"拒绝+回落+喊"不静默,
# 它正是下界那条已经用对的形态, 我没把它对称地用到上界。
# 上界仍是推导的: 测量一发脉冲花的时间不该超过这发脉冲本身 ⇒ 阈值 = PULSE_SEC。
Run-Settle 'at ceiling (20000) -> accepted' '20000' 20000 $false
Run-Settle 'over ceiling -> REJECTED'       '999999999' 1500 $true
Run-Settle 'one ms over ceiling -> REJECTED' '20001' 1500 $true

Say ''
Say '--- part 5: the real config-composition path (Codex: part 4 always injected PULSE_SEC=20) ---'
# 🔴 part 4 把 $PULSE_SEC=20 注进一个只抽了 settle 校验的片段 ⇒ 它证明的是"在一个被信任的 fixture 下
#    settle 分支对", 而不是"这个脚本实际用的配置组合对"。Codex 点名要这一格。
#    这里把【配置块】与【settle 校验块】一起抽出来拼起来跑, 并且用【真的 env 变量】驱动, 不注入任何值。
$cs = -1; $ce = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\$CFG_ISSUES = ') { $cs = $i; break } }
if ($cs -lt 0) { throw 'FIXTURE-BROKEN: cannot find the config block start' }
for ($i = $cs; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^\`$PULSE_CHECK = Get-BoundedEnv") { $ce = $i; break } }
if ($ce -lt 0) { throw 'FIXTURE-BROKEN: cannot find the config block end' }
# 关系不变式(边集)在那些 Get-BoundedEnv 之后, 必须一起抽 —— 第一版终点停在 PULSE_CHECK 那行,
# 于是关系用例全绿地测了个空气(与之前漏抽 emit 行同一形状: 抽少了)。
# 🔵 找不到就【不延伸】而不是抛 FIXTURE-BROKEN: 这样"删掉关系块"的变异体会让【用例变红】,
#    而不是让 fixture 先炸 —— 真失败信号不该被更早的断言盖住(part 2 那条教训)。
# 锚在一个【不随被测代码消失】的标记上。原先拿"关系 if 那一行"当锚, 于是删掉一个关系块的变异体
# 会把两个都排除出被测范围, 红的条数超出它真实的波及面 —— 报出来的是锚的脆弱程度, 不是缺陷大小。
for ($i = $ce; $i -lt $lines.Count; $i++) { if ($lines[$i] -match 'CONFIG-DOMAIN-END') { $ce = $i; break } }
$cfgBlock = ($lines[$cs..$ce] -join "`n")
if ($cfgBlock -notmatch 'TN12_PULSE_SEC') { throw 'FIXTURE-BROKEN: extracted config block does not contain PULSE_SEC' }
# 🔴 把【喊出来】那一行也抽进来。第一版漏了它 ⇒ 组合路径里问题被记下却从没被喊, 基线自己就红了 ——
#    这是好事: 漏抽的那一段立刻显形, 而不是悄悄让某个变异体变绿。
#    (它在生产文件里位于 settle 校验块之前, 中间只有函数定义, 所以拼接顺序就是真实执行顺序。)
$emitLine = ($lines | Where-Object { $_ -match '^foreach \(\$issue in \$CFG_ISSUES\)' })
if (-not $emitLine) { $emitLine = '# (emit line absent in this build)' }
Say ("extracted config lines {0}-{1} + the settle validator ({2} lines total)" -f ($cs+1), ($ce+1), (($ce-$cs+1) + ($ve-$vs+1)))

$ENV_NAMES = @('TN12_PULSE_SEC','TN12_DAA_SETTLE_MS','TN12_POLL_SEC','TN12_MAX_PULSES','TN12_PULSE_CHECK','TN12_TIPS_BRAKE','TN12_TIPS_RESUME','TN12_MAX_ROUNDS')
function Run-Compose($name, $env, $expPulse, $expSettle, $expIssues) {
  foreach ($n in $ENV_NAMES) { [Environment]::SetEnvironmentVariable($n, $null) }
  foreach ($k in $env.Keys) { [Environment]::SetEnvironmentVariable($k, $env[$k]) }
  $script:alerts = @(); $script:logs = @()
  # 组合路径: 配置块 → (真实脚本里这中间只有函数定义) → settle 校验块
  $sb = [scriptblock]::Create(
    "function Alert(`$m){ `$script:alerts += @(`$m) }`nfunction Log(`$m){ `$script:logs += @(`$m) }`n" +
    $cfgBlock + "`n" + $emitLine + "`n" + $initLine + "`n" + '$DAA_SETTLE_RAW = [Environment]::GetEnvironmentVariable("TN12_DAA_SETTLE_MS")' + "`n" + $validate)
  . $sb
  foreach ($n in $ENV_NAMES) { [Environment]::SetEnvironmentVariable($n, $null) }
  # 🔴 只数【喊出来的】, 不数【记下来的】。第一版我写的是 CFG_ISSUES.Count + alerts.Count,
  #    于是拆掉"把配置问题喊出来"那一步的变异体(mut13)【全绿】—— 问题仍被记着, 只是没人听见。
  #    而这正是我在代码注释里刚写过的那句: 存进数组从不喊出来, 与没有校验器读数完全相同。
  #    **我断言了错的那个量。** 断言必须落在【操作员真的会看到的东西】上。
  $issues = $script:alerts.Count
  $ok = ($PULSE_SEC -eq $expPulse) -and ($DAA_SETTLE_MS -eq $expSettle) -and ($issues -eq $expIssues)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Say ("[{0}] {1,-42} PULSE_SEC={2,-4} SETTLE={3,-8} issues={4}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $PULSE_SEC, $DAA_SETTLE_MS, $issues)
  if (-not $ok) { Say ("       expected PULSE_SEC={0} SETTLE={1} issues={2}" -f $expPulse, $expSettle, $expIssues) }
}

# 关系不变式的两个驱动器。与 Run-Compose 同一条组合路径, 只是断言落在【那一对】上。
function Invoke-Cfg($env) {
  foreach ($n in $ENV_NAMES) { [Environment]::SetEnvironmentVariable($n, $null) }
  foreach ($k in $env.Keys) { [Environment]::SetEnvironmentVariable($k, $env[$k]) }
  $script:alerts = @(); $script:logs = @()
  $sb = [scriptblock]::Create(
    "function Alert(`$m){ `$script:alerts += @(`$m) }`nfunction Log(`$m){ `$script:logs += @(`$m) }`n" +
    $cfgBlock + "`n" + $emitLine)
  . $sb
  foreach ($n in $ENV_NAMES) { [Environment]::SetEnvironmentVariable($n, $null) }
  return @{ brake = $TIPS_BRAKE; resume = $TIPS_RESUME; maxp = $MAX_PULSES; chk = $PULSE_CHECK; alerts = $script:alerts.Count }
}
function Run-Rel($name, $env, $expBrake, $expResume, $expAlerts) {
  $r = Invoke-Cfg $env
  $ok = ($r.brake -eq $expBrake) -and ($r.resume -eq $expResume) -and ($r.alerts -eq $expAlerts)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Say ("[{0}] {1,-42} BRAKE={2,-4} RESUME={3,-4} alerts={4}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $r.brake, $r.resume, $r.alerts)
  if (-not $ok) { Say ("       expected BRAKE={0} RESUME={1} alerts={2}" -f $expBrake, $expResume, $expAlerts) }
}
function Run-Rel2($name, $env, $expMaxP, $expChk, $expAlerts) {
  $r = Invoke-Cfg $env
  $ok = ($r.maxp -eq $expMaxP) -and ($r.chk -eq $expChk) -and ($r.alerts -eq $expAlerts)
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Say ("[{0}] {1,-42} MAX_PULSES={2,-4} CHECK={3,-4} alerts={4}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $r.maxp, $r.chk, $r.alerts)
  if (-not $ok) { Say ("       expected MAX_PULSES={0} CHECK={1} alerts={2}" -f $expMaxP, $expChk, $expAlerts) }
}

Run-Compose 'defaults'                      @{} 20 1500 0
Run-Compose 'PULSE_SEC malformed -> default' @{ 'TN12_PULSE_SEC' = 'abc' } 20 1500 1
Run-Compose 'PULSE_SEC=0 -> rejected'        @{ 'TN12_PULSE_SEC' = '0' }   20 1500 1
Run-Compose 'PULSE_SEC=-1 -> rejected'       @{ 'TN12_PULSE_SEC' = '-1' }  20 1500 1
# 🔴 下界是【推导的】: 脉冲必须至少容得下强制的 settle 默认 1500ms ⇒ 1s 不合法, 2s 合法。
Run-Compose 'PULSE_SEC=1 below derived min'  @{ 'TN12_PULSE_SEC' = '1' }   20 1500 1
Run-Compose 'PULSE_SEC=2 at derived min'     @{ 'TN12_PULSE_SEC' = '2' }    2 1500 0
Run-Compose 'PULSE_SEC=99999 -> rejected'    @{ 'TN12_PULSE_SEC' = '99999' } 20 1500 1
# 🔴 组合路径的全部意义在这两条: settle 的天花板【随 PULSE_SEC 一起动】。
#    part 4 那种写死 20 的 fixture 结构上测不到它们。
Run-Compose 'ceiling follows PULSE_SEC (ok)' @{ 'TN12_PULSE_SEC' = '60'; 'TN12_DAA_SETTLE_MS' = '50000' } 60 50000 0
Run-Compose 'same settle now over ceiling'   @{ 'TN12_PULSE_SEC' = '30'; 'TN12_DAA_SETTLE_MS' = '50000' } 30 1500 1
Run-Compose 'bad PULSE_SEC + settle at old ceiling' @{ 'TN12_PULSE_SEC' = 'abc'; 'TN12_DAA_SETTLE_MS' = '20000' } 20 20000 1

# ── 关系不变式(边集)。🔴 Codex 纠的是我"走完了图"那句话本身: 我走的是节点集, 没走边集。
#    这几条的共同点: **每个值单独看都在域内**, 坏的是【组合】—— 所以只测单变量的用例结构上看不见它们。
Run-Rel 'RESUME >= BRAKE (inverted) -> pair reset' @{ 'TN12_TIPS_BRAKE' = '220'; 'TN12_TIPS_RESUME' = '500' } 220 50 1
Run-Rel 'RESUME == BRAKE (equality) -> pair reset' @{ 'TN12_TIPS_BRAKE' = '300'; 'TN12_TIPS_RESUME' = '300' } 220 50 1
Run-Rel 'RESUME < BRAKE (coherent) -> kept'        @{ 'TN12_TIPS_BRAKE' = '300'; 'TN12_TIPS_RESUME' = '80'  } 300 80 0
Run-Rel2 'PULSE_CHECK > MAX_PULSES -> pair reset'  @{ 'TN12_MAX_PULSES' = '4'; 'TN12_PULSE_CHECK' = '5' } 20 5 1
Run-Rel2 'PULSE_CHECK == MAX_PULSES -> kept'       @{ 'TN12_MAX_PULSES' = '5'; 'TN12_PULSE_CHECK' = '5' }  5 5 0
Run-Rel2 'normal multi-window (20/5) -> kept'      @{ 'TN12_MAX_PULSES' = '20'; 'TN12_PULSE_CHECK' = '5' } 20 5 0

Say ''
Say '--- part 6: the config surface is CLOSED (this is the completion state, not another square) ---'
# 🔴 @Bettor 12:2x 说得对:**无限递归不是闸, 是没定义完成态**。前六格每闭一格就暴露下一个未校验量,
#    而"我觉得查完了"不是完成态。这一条把完成态写成【机械可判】的:
#      配置面闭合 ⇔ 文件里每一个 TN12_ 环境读取点, 要么走受控解析器, 要么在豁免表里带理由。
# 🔴 它【去发现, 不去记住】(在册: enumerating-tools-must-discover-not-remember):
#    名单从文件正文扫出来, 不是我写死的一张表 —— 所以将来谁加第九个裸读, 是【这条用例】红,
#    而不是等下一轮外部复审替我们发现。递归就是在这里终止的。
# 🔴🔴 2026-08-10 重写: Codex 打掉了上一版, 而他打中的是这条判据的【根】——
#    上一版证的是【名字】不是【读取点】:
#      $PULSE_SEC = Get-BoundedEnv 'TN12_PULSE_SEC' ...   ← 名字进了 $bounded
#      $rawAgain  = $env:TN12_PULSE_SEC                   ← 绕开校验值, 而用例照样绿
#    豁免那条更糟: 按【名字】豁免 ⇒ 将来任何一处对 TN12_DAA_SETTLE_MS 的裸读都被老豁免自动罩住。
#    🔨 **加再多语法正则也修不了「名字→站点」这个证明错位。** 语法缝和语义缝是两件事。
#    ⇒ 采他给的第 ② 条路(最强的那条): **站点制** —— 逐个列出每一处 TN12 环境读取【occurrence】,
#      每一处都必须是【被批准的站点】; 豁免按【整行原文】而不是按名字。
$readSites = [System.Collections.ArrayList]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
  $l = $lines[$i]
  if ($l -match '^\s*#') { continue }                      # 注释里的示例不算读取点
  if ($l -match '\$env:TN12_\w+' -or $l -match '\$\{env:TN12_\w+\}' -or
      $l -match 'GetEnvironmentVariable\(["'']TN12_\w+["'']' -or $l -match '(?i)\bEnv:TN12_\w+') {
    [void]$readSites.Add([pscustomobject]@{ n = $i + 1; t = $l.Trim() })
  }
}
# 被批准的站点: 按【整行】匹配。今天恰好一处 —— 那条喂给专属 settle 校验器的裸读。
# 🔴 站点级而不是名字级, 正是 Codex 那条的要害: 同一个变量在别处再读一次, 是【另一行】, 就是违规。
$APPROVED_SITES = @(
  '$DAA_SETTLE_RAW        = $env:TN12_DAA_SETTLE_MS'
)
$violations = [System.Collections.ArrayList]::new()
foreach ($s in $readSites) { if ($APPROVED_SITES -notcontains $s.t) { [void]$violations.Add($s) } }
# 陈站点也要红: 一条指向已经不存在的行的批准, 会在将来某行恰好长成那样时无声地罩住它。
$staleSites = [System.Collections.ArrayList]::new()
foreach ($a in $APPROVED_SITES) { $hit = $false; foreach ($s in $readSites) { if ($s.t -eq $a) { $hit = $true } }; if (-not $hit) { [void]$staleSites.Add($a) } }
$siteOk = ($violations.Count -eq 0) -and ($staleSites.Count -eq 0)
if ($siteOk) { $script:pass++ } else { $script:fail++ }
Say ("[{0}] {1,-42} readSites={2} approved={3} violations={4}" -f $(if ($siteOk) { 'PASS' } else { 'FAIL' }), 'every TN12 env READ SITE is approved', $readSites.Count, $APPROVED_SITES.Count, $violations.Count)
foreach ($v in $violations) { Say ("       [RED] line {0}: {1}" -f $v.n, $v.t) }
foreach ($a in $staleSites) { Say ("       [RED] approved site no longer present: {0}" -f $a) }

# 🔴 这里原本还有一条【按名字】的检查(每个 TN12_ 名字必须有域)。**删掉了, 不是因为重复, 是因为它在
#    对抗输入上打绿灯**: Codex 点名的两条阴性(已受控名字的第二次裸读 / 已豁免名字的第二次裸读)
#    实跑读数 —— 站点检查 FAIL, 而那条名字检查【两次都 PASS】。
#    ⇒ 站点检查严格更强(逐处 vs 逐名), 而一条会在真缺陷面前打绿的检查留着, 只会在将来有人
#      拆掉站点检查时给出假安慰。**能被证明不足的完成态判据, 不该留在文件里冒充第二道闸。**

Say ''
Say ("result: {0} PASS / {1} FAIL" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
