# Evaluate every measure of a local Desktop model at total level: one query per measure. Prints a summary
# (ok / blank / error / slow) plus the error and slow lists. No values printed (safe for confidential models).
param([int]$Port, [int]$SlowMs = 10000)
Add-Type -Path "C:\Program Files (x86)\Tabular Editor\Microsoft.AnalysisServices.Tabular.dll"
Add-Type -Path "C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.PowerBI.AdomdClient.dll"
$srv = New-Object Microsoft.AnalysisServices.Tabular.Server; $srv.Connect("Data Source=localhost:$Port")
$names = foreach ($t in $srv.Databases[0].Model.Tables) { foreach ($m in $t.Measures) { $m.Name } }
$srv.Disconnect()
$c = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$Port"); $c.Open()
$ok = 0; $blank = 0; $errs = @(); $slow = @()
foreach ($n in $names) {
  $q = "EVALUATE ROW(""v"", [" + $n.Replace("]", "]]") + "])"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try { $cmd = $c.CreateCommand(); $cmd.CommandText = $q; $cmd.CommandTimeout = 120; $r = $cmd.ExecuteReader()
        $v = if ($r.Read()) { $r.GetValue(0) } else { $null }; $r.Close()
        if ($null -eq $v -or $v -is [DBNull]) { $blank++ } else { $ok++ } }
  catch { $errs += "$n :: " + $_.Exception.Message.Split("`n")[0] }
  if ($sw.ElapsedMilliseconds -gt $SlowMs) { $slow += "$n :: $($sw.ElapsedMilliseconds) ms" }
}
$c.Close()
"measures: $($names.Count) | value: $ok | blank: $blank | error: $($errs.Count) | slow (>$SlowMs ms): $($slow.Count)"
if ($errs) { "-- errors"; $errs }
if ($slow) { "-- slow"; $slow }
