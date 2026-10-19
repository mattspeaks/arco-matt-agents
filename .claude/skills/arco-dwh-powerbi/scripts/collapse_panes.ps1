param(
    [Parameter(Mandatory = $true)][string]$TitleLike,      # part of the report's Desktop window title, e.g. "Jobs by PA"
    [switch]$Apply,                                          # without -Apply: list the panes and their state only (read-only)
    [int]$WaitSeconds = 0                                    # wait up to N seconds for the window to appear (right after launch)
)
<#
Collapse Power BI Desktop's side panes (Visualizations, Data, and any open Bookmarks / Selection / Sync slicers / Performance
analyzer pane) in ONE report window, through UI Automation (ExpandCollapsePattern): no mouse clicks or keystrokes, no settings files.
User preference 2026-10-11: Desktop opens with all panes collapsed.
Findings (2026-10-11): pane state is not stored in the PBIP (.pbi/localSettings.json), report.json or the Desktop user settings
(User.zip Settings.xml); Desktop restores it per session. The Filters pane is the exception: its collapse state IS a report
setting (report.json objects.outspacePane expanded) that also decides how report readers see it, so this helper never touches it.

FOCUS RULE (user 2026-10-12, standing): never steal the user's cursor / focus. This script never activates, raises or focuses any
window: no SetForegroundWindow, no AppActivate, no SendKeys, no mouse. It only READS the foreground window (GetForegroundWindow)
as a guard: if the foreground window changes to Desktop during -Apply, it STOPS at once and reports FOCUS_CHANGED; it never tries
to "give focus back" (that would be another focus call). If you see FOCUS_CHANGED, don't rerun: ask MGR so the user can be told.
Usage: powershell -File collapse_panes.ps1 -TitleLike "Jobs by PA" [-Apply] [-WaitSeconds 120]
#>
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace FocusGuard -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
$AE = [System.Windows.Automation.AutomationElement]
$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
    $proc = Get-Process PBIDesktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$TitleLike*" } | Select-Object -First 1
    if (-not $proc -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
} while (-not $proc -and (Get-Date) -lt $deadline)
if (-not $proc) { Write-Output "NO WINDOW: no Power BI Desktop window title contains '$TitleLike'"; exit 1 }
$hwnd = $proc.MainWindowHandle
$fgStart = [FocusGuard.User32]::GetForegroundWindow()
$root = $AE::FromHandle($hwnd)
$names = @("Visualizations", "Data", "Bookmarks", "Selection", "Sync slicers", "Performance analyzer", "Filters on this page")
$cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$script:focusLost = $false

function FocusMoved {
    # true when Desktop became the foreground window during this run although it wasn't at the start
    $fg = [FocusGuard.User32]::GetForegroundWindow()
    return ($fg -eq $hwnd -and $fgStart -ne $hwnd)
}

function Pass([bool]$doApply, [bool]$quiet) {
    $c = 0
    foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        $n = $e.Current.Name
        if ($names -notcontains $n) { continue }
        try { $ep = $e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern) } catch { continue }
        $state = $ep.Current.ExpandCollapseState
        if ($doApply -and $state -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
            $ep.Collapse(); $c++
            Write-Output ("collapsed: {0} (was {1})" -f $n, $state)
            if (FocusMoved) { $script:focusLost = $true; Write-Output "FOCUS_CHANGED: Desktop came to the front after collapsing '$n'; stopped. Ask MGR before running this again."; return $c }
        } elseif (-not $quiet) {
            Write-Output ("{0}: {1}" -f $n, $state)
        }
    }
    return $c
}
# Desktop keeps drawing panes while a report finishes loading (tested 2026-10-11: Visualizations appeared on the 3rd pass), so
# with -Apply repeat until 3 passes in a row (5 s apart) find nothing left to collapse, up to ~2 minutes.
$changed = 0
if ($Apply) {
    if ($fgStart -eq $hwnd) { Write-Output "note: Desktop was already the foreground window when this started (the user is in it); collapsing anyway changes no focus." }
    $quietPasses = 0; $tries = 0
    while ($quietPasses -lt 3 -and $tries -lt 24 -and -not $script:focusLost) {
        $out = @(Pass $true $true)
        $n_ = [int]$out[-1]; $out[0..($out.Count - 2)] | Where-Object { $_ } | ForEach-Object { Write-Output $_ }
        $changed += $n_
        if ($n_ -eq 0) { $quietPasses++ } else { $quietPasses = 0 }
        $tries++
        if ($quietPasses -lt 3 -and -not $script:focusLost) { Start-Sleep -Seconds 5 }
    }
}
if (-not $script:focusLost) { Pass $false $false | Where-Object { $_ -isnot [int] } }
Write-Output ("window '{0}' (pid {1}): {2} pane(s) collapsed; focus {3}" -f $proc.MainWindowTitle, $proc.Id, $changed, $(if ($script:focusLost) { "CHANGED (stopped)" } else { "unchanged" }))
if ($script:focusLost) { exit 3 }
