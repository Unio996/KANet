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
Say ("result: {0} PASS / {1} FAIL" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
