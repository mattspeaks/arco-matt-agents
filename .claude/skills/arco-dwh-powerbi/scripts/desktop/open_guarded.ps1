# Open a PBIP minimized with a crash guard, then ONE capped refresh.
# Rules (memory feedback_stale_cache_abf): move .pbi\cache.abf aside first; a window still "Untitled" after -UntitledSec is a load
# failure: kill it, report the newest crash snapshot, never retry. Treat a refresh "OK" in under 30 s as suspect (check row counts).
param([string]$Pbip, [string]$Title, [int]$CapSec, [int]$UntitledSec = 180, [int]$LoadSec = 720)
$cache = Join-Path (Split-Path $Pbip) ((Split-Path $Pbip -Leaf) -replace '\.pbip$', '.SemanticModel\.pbi\cache.abf')
if (Test-Path $cache) { Rename-Item $cache ("cache.abf.stale_" + (Get-Date -Format yyyyMMddHHmm)); "moved stale cache aside" }
$before = @(Get-Process PBIDesktop -ErrorAction SilentlyContinue | ForEach-Object Id)
Start-Process -FilePath $Pbip -WindowStyle Minimized
$t = 0; $new = $null
do { Start-Sleep 15; $t += 15
  $new = Get-Process PBIDesktop -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | Select-Object -First 1
  if ($new -and $t -ge $UntitledSec -and $new.MainWindowTitle -match '^Untitled') {
    Stop-Process -Id $new.Id -Force
    $z = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Power BI Desktop" -Filter "FrownSnapShot*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    "LOAD FAILED (Untitled after $t s); killed; newest snapshot $($z.Name) $($z.LastWriteTime)"; return }
} until (($new -and $new.MainWindowTitle -match $Title) -or $t -ge $LoadSec)
if (-not ($new -and $new.MainWindowTitle -match $Title)) { if ($new) { Stop-Process -Id $new.Id -Force }; "LOAD TIMEOUT after $t s"; return }
"PID $($new.Id) loaded after $t s"; Start-Sleep 20
& "$PSScriptRoot\refresh_full_capped.ps1" -Pid2 $new.Id -CapSec $CapSec
