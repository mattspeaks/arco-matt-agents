# Run DAX queries against a local Power BI Desktop engine. Queries in -File are separated by lines "-- NEXT".
param([string]$File, [int]$Port)
Add-Type -Path "C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.PowerBI.AdomdClient.dll"
$c = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$Port")
$c.Open()
$q = [IO.File]::ReadAllText($File)
foreach ($part in ($q -split "(?m)^-- NEXT\s*$")) {
  if (-not $part.Trim()) { continue }
  try {
    $cmd = $c.CreateCommand(); $cmd.CommandText = $part
    $r = $cmd.ExecuteReader()
    "---- " + ((0..($r.FieldCount-1) | ForEach-Object { $r.GetName($_) }) -join " | ")
    while ($r.Read()) { (0..($r.FieldCount-1) | ForEach-Object { $r.GetValue($_) }) -join " | " }
    $r.Close()
  } catch { "ERROR: " + $_.Exception.Message }
}
$c.Close()
