# ONE refresh pass with per-table timing: each table gets a DataOnly refresh in turn (dims first), then one Calculate for calc
# columns / tables. Same warehouse work as a full refresh. Stops at the first failure (no retries); a total cap stops the pass.
param([int]$Pid2, [int]$CapSec = 1200, [string[]]$First = @())
$ms = Get-CimInstance Win32_Process -Filter "Name='msmdsrv.exe'" | Where-Object { $_.ParentProcessId -eq $Pid2 }
$port = (Get-NetTCPConnection -OwningProcess $ms.ProcessId -State Listen | Select-Object -First 1).LocalPort
Add-Type -Path "C:\Program Files (x86)\Tabular Editor\Microsoft.AnalysisServices.Tabular.dll"
$srv = New-Object Microsoft.AnalysisServices.Tabular.Server; $srv.Connect("Data Source=localhost:$port")
$m = $srv.Databases[0].Model
$tables = @($m.Tables | Where-Object { $_.Partitions.Count -gt 0 -and $_.Partitions[0].SourceType -ne 'Calculated' })
$order = @($tables | Where-Object { $First -contains $_.Name }) + @($tables | Where-Object { $First -notcontains $_.Name })
$all = [Diagnostics.Stopwatch]::StartNew(); $failed = $false
foreach ($t in $order) {
  if ($all.Elapsed.TotalSeconds -gt $CapSec) { "CAP reached ($CapSec s) before $($t.Name); stopped"; $failed = $true; break }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $t.RequestRefresh([Microsoft.AnalysisServices.Tabular.RefreshType]::DataOnly)
  try { [void]$m.SaveChanges(); "{0,7:N1} s  {1}" -f $sw.Elapsed.TotalSeconds, $t.Name }
  catch { "FAILED {0} after {1:N1} s: {2}" -f $t.Name, $sw.Elapsed.TotalSeconds, $_.Exception.Message.Split("`n")[0]; $failed = $true; break }
}
if (-not $failed) {
  $sw = [Diagnostics.Stopwatch]::StartNew(); $m.RequestRefresh([Microsoft.AnalysisServices.Tabular.RefreshType]::Calculate)
  try { [void]$m.SaveChanges(); "{0,7:N1} s  (calculate: calc columns / tables)" -f $sw.Elapsed.TotalSeconds } catch { "FAILED calculate: " + $_.Exception.Message.Split("`n")[0] }
}
"TOTAL {0:N0} s on port {1}" -f $all.Elapsed.TotalSeconds, $port
foreach ($t in $m.Tables) { if ($t.Partitions.Count -gt 0 -and $t.Partitions[0].State -ne 'Ready') { "NOT READY: $($t.Name) $($t.Partitions[0].State)" } }
$srv.Disconnect()
