# Parse .sql files with the Fabric DW T-SQL parser (ScriptDom from SSMS 22). -Paths: files and / or folders.
param([string[]]$Paths)
Add-Type -Path "C:\Program Files\Microsoft SQL Server Management Studio 22\Release\Common7\IDE\Extensions\Application\Microsoft.SqlServer.TransactSql.ScriptDom.dll"
$t = [Microsoft.SqlServer.TransactSql.ScriptDom.TSqlParser].Assembly.GetType("Microsoft.SqlServer.TransactSql.ScriptDom.TSqlFabricDWParser")
if ($t) { $parser = [Activator]::CreateInstance($t, [object[]]@($true)); $pname = "TSqlFabricDWParser" } else { $parser = New-Object Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser($true); $pname = "TSql160Parser (no Fabric parser found)" }
"fabric parser: $pname"
$files = foreach ($p in $Paths) { if (Test-Path $p -PathType Container) { Get-ChildItem $p -Filter *.sql -Recurse | ForEach-Object FullName } else { $p } }
$bad = 0
foreach ($f in $files) {
  $errs = $null; $rd = New-Object IO.StringReader([IO.File]::ReadAllText($f)); [void]$parser.Parse($rd, [ref]$errs)
  if ($errs.Count) { $bad++; foreach ($e in $errs) { "{0}: line {1} col {2}: {3}" -f (Split-Path $f -Leaf), $e.Line, $e.Column, $e.Message } }
}
"parsed $(@($files).Count) files, $bad with errors"
