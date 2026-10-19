# ONE full TOM refresh of the Desktop engine owned by PID -Pid2; a watchdog cancels long-running commands after -CapSec.
param([int]$Pid2, [int]$CapSec = 900)
$ms = Get-CimInstance Win32_Process -Filter "Name='msmdsrv.exe'" | Where-Object { $_.ParentProcessId -eq $Pid2 }
$port = (Get-NetTCPConnection -OwningProcess $ms.ProcessId -State Listen | Select-Object -First 1).LocalPort
Add-Type -Path "C:\Program Files (x86)\Tabular Editor\Microsoft.AnalysisServices.Tabular.dll"
$srv = New-Object Microsoft.AnalysisServices.Tabular.Server; $srv.Connect("Data Source=localhost:$port")
$db = $srv.Databases[0]
$job = Start-Job -ArgumentList $port, $CapSec -ScriptBlock { param($port, $cap)
  Start-Sleep $cap
  Add-Type -Path "C:\Program Files (x86)\Tabular Editor\Microsoft.AnalysisServices.Tabular.dll"
  $s2 = New-Object Microsoft.AnalysisServices.Tabular.Server; $s2.Connect("Data Source=localhost:$port")
  Add-Type -Path "C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.PowerBI.AdomdClient.dll"
  $c = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$port"); $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = "SELECT SESSION_SPID, COMMAND_ELAPSED_TIME_MS FROM `$SYSTEM.DISCOVER_COMMANDS"
  $r = $cmd.ExecuteReader(); $spids = @(); while ($r.Read()) { if ([int64]$r.GetValue(1) -gt 60000) { $spids += $r.GetValue(0) } }; $r.Close(); $c.Close()
  foreach ($sp in $spids) { [void]$s2.Execute("<Cancel xmlns=`"http://schemas.microsoft.com/analysisservices/2003/engine`"><SPID>$sp</SPID><CancelAssociated>true</CancelAssociated></Cancel>") }
  "watchdog fired at $cap s" }
$sw = [Diagnostics.Stopwatch]::StartNew()
$db.Model.RequestRefresh([Microsoft.AnalysisServices.Tabular.RefreshType]::Full)
try { [void]$db.Model.SaveChanges(); "OK port $port in $([int]$sw.Elapsed.TotalSeconds)s" } catch { "FAILED after $([int]$sw.Elapsed.TotalSeconds)s: " + $_.Exception.Message.Substring(0, [Math]::Min(2500, $_.Exception.Message.Length)) }
Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue
foreach ($t in $db.Model.Tables) { if ($t.Partitions.Count -gt 0 -and $t.Partitions[0].State -ne 'Ready') { "NOT READY: $($t.Name) $($t.Partitions[0].State)" } }
$srv.Disconnect()
