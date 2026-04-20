$ErrorActionPreference = 'Stop'

function Get-Stats {
    param([long[]]$Values)
    if (-not $Values -or $Values.Count -eq 0) {
        return [pscustomobject]@{ count = 0; avg_ms = 0; min_ms = 0; p95_ms = 0; max_ms = 0 }
    }

    $sorted = $Values | Sort-Object
    $idx = [Math]::Ceiling(0.95 * $sorted.Count) - 1
    if ($idx -lt 0) { $idx = 0 }

    [pscustomobject]@{
        count = $sorted.Count
        avg_ms = [Math]::Round((($sorted | Measure-Object -Average).Average), 2)
        min_ms = $sorted[0]
        p95_ms = $sorted[$idx]
        max_ms = $sorted[$sorted.Count - 1]
    }
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-WebRequest -Uri "http://localhost:8000/api/v1/auth/login" -Method Post -ContentType "application/x-www-form-urlencoded" -Body "username=consultor@kyrustech.com&password=consultor123" -WebSession $session -TimeoutSec 30
$null = Invoke-WebRequest -Uri "http://localhost:8000/api/v1/usuarios/me" -Method Get -WebSession $session -TimeoutSec 30

$stamp = Get-Date -Format "yyyyMMddHHmmss"
$ccBody = @{ nome = "CC Carga $stamp" } | ConvertTo-Json -Compress
$cc = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/centro-custo/" -Method Post -ContentType "application/json" -Body $ccBody -WebSession $session -TimeoutSec 30

$contaBody = @{
    nome = "Conta Carga $stamp"
    tipo = "BANCO"
    banco = "Teste"
    saldo_inicial = 0
    status = "ATIVO"
    tipo_integracao = "MANUAL"
    centro_custo_id = [int]$cc.id
} | ConvertTo-Json -Compress
$conta = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/contas/" -Method Post -ContentType "application/json" -Body $contaBody -WebSession $session -TimeoutSec 30
$contaId = [int]$conta.id

$ofxPath = Join-Path $PSScriptRoot "..\tmp_load_test.ofx"
$ofxPath = (Resolve-Path (Split-Path $ofxPath -Parent)).Path + "\tmp_load_test.ofx"

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("OFXHEADER:100")
$null = $sb.AppendLine("DATA:OFXSGML")
$null = $sb.AppendLine("VERSION:102")
$null = $sb.AppendLine("SECURITY:NONE")
$null = $sb.AppendLine("ENCODING:USASCII")
$null = $sb.AppendLine("CHARSET:1252")
$null = $sb.AppendLine("COMPRESSION:NONE")
$null = $sb.AppendLine("OLDFILEUID:NONE")
$null = $sb.AppendLine("NEWFILEUID:NONE")
$null = $sb.AppendLine("")
$null = $sb.AppendLine("<OFX>")
$null = $sb.AppendLine("<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260419120000[-3:BRT]</SONRS></SIGNONMSGSRSV1>")
$null = $sb.AppendLine("<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS>")
$null = $sb.AppendLine("<CURDEF>BRL")
$null = $sb.AppendLine("<BANKACCTFROM><BANKID>0001<ACCTID>123456<ACCTTYPE>CHECKING</BANKACCTFROM>")
$null = $sb.AppendLine("<BANKTRANLIST><DTSTART>20260101000000<DTEND>20260419000000")
for ($i = 1; $i -le 5000; $i++) {
    $d = (Get-Date "2026-01-01").AddDays($i % 100).ToString("yyyyMMdd") + "120000"
    $amtBase = [Math]::Round(((($i % 17) + 1) * 2.13), 2)
    $amt = if ($i % 3 -eq 0) { "-$amtBase" } else { "$amtBase" }
    $type = if ($i % 3 -eq 0) { "DEBIT" } else { "CREDIT" }
    $null = $sb.AppendLine("<STMTTRN><TRNTYPE>$type<DTPOSTED>$d<TRNAMT>$amt<FITID>LOADTEST-$i<NAME>MOVIMENTO TESTE $i<MEMO>Benchmark concorrencia</STMTTRN>")
}
$null = $sb.AppendLine("</BANKTRANLIST>")
$null = $sb.AppendLine("<LEDGERBAL><BALAMT>15000.00<DTASOF>20260419000000</LEDGERBAL>")
$null = $sb.AppendLine("</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>")
[System.IO.File]::WriteAllText($ofxPath, $sb.ToString(), [System.Text.Encoding]::ASCII)

$cookieHeader = (($session.Cookies.GetCookies("http://localhost:8000") | ForEach-Object { "{0}={1}" -f $_.Name, $_.Value }) -join '; ')

$baselineHealth = @()
$baselineMe = @()
for ($i = 0; $i -lt 25; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/health" -Method Get -TimeoutSec 30
        $null = $r.StatusCode
    } catch {}
    $sw.Stop()
    $baselineHealth += $sw.ElapsedMilliseconds
}

for ($i = 0; $i -lt 20; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/api/v1/usuarios/me" -Method Get -WebSession $session -TimeoutSec 30
        $null = $r.StatusCode
    } catch {}
    $sw.Stop()
    $baselineMe += $sw.ElapsedMilliseconds
}

$job = Start-Job -ScriptBlock {
    param($cookieHeaderParam, $contaIdParam, $ofxFileParam)
    $swHeavy = [System.Diagnostics.Stopwatch]::StartNew()
    $status = curl.exe -s -o NUL -w "%{http_code}" -H "Cookie: $cookieHeaderParam" -F "arquivo=@$ofxFileParam" "http://localhost:8000/api/v1/importacao/ofx/upload?conta_id=$contaIdParam"
    $swHeavy.Stop()
    [pscustomobject]@{ status = [string]$status; elapsed_ms = [int]$swHeavy.ElapsedMilliseconds }
} -ArgumentList $cookieHeader, $contaId, $ofxPath

$duringHealth = @()
$duringMe = @()
$healthFailures = 0
$meFailures = 0

for ($i = 0; $i -lt 35; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/health" -Method Get -TimeoutSec 30
        if ($r.StatusCode -ne 200) { $healthFailures++ }
    } catch {
        $healthFailures++
    }
    $sw.Stop()
    $duringHealth += $sw.ElapsedMilliseconds
}

for ($i = 0; $i -lt 25; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8000/api/v1/usuarios/me" -Method Get -WebSession $session -TimeoutSec 30
        if ($r.StatusCode -ne 200) { $meFailures++ }
    } catch {
        $meFailures++
    }
    $sw.Stop()
    $duringMe += $sw.ElapsedMilliseconds
}

$heavy = Receive-Job -Job $job -Wait
Remove-Job -Job $job -Force | Out-Null

$baselineHealthStats = Get-Stats -Values $baselineHealth
$baselineMeStats = Get-Stats -Values $baselineMe
$duringHealthStats = Get-Stats -Values $duringHealth
$duringMeStats = Get-Stats -Values $duringMe

Write-Output "TEST_ACCOUNT_ID=$contaId"
Write-Output "HEAVY_UPLOAD_STATUS=$($heavy.status) HEAVY_UPLOAD_MS=$($heavy.elapsed_ms)"
Write-Output "BASELINE_HEALTH avg=$($baselineHealthStats.avg_ms) p95=$($baselineHealthStats.p95_ms) max=$($baselineHealthStats.max_ms)"
Write-Output "DURING_HEALTH   avg=$($duringHealthStats.avg_ms) p95=$($duringHealthStats.p95_ms) max=$($duringHealthStats.max_ms) fails=$healthFailures"
Write-Output "BASELINE_ME     avg=$($baselineMeStats.avg_ms) p95=$($baselineMeStats.p95_ms) max=$($baselineMeStats.max_ms)"
Write-Output "DURING_ME       avg=$($duringMeStats.avg_ms) p95=$($duringMeStats.p95_ms) max=$($duringMeStats.max_ms) fails=$meFailures"
