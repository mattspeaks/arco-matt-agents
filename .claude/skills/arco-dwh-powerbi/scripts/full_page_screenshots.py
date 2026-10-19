"""Screenshot EVERY page of a PBIP report showing the WHOLE page (user rule 2026-10-02: "always make sure you can see the whole view").

`powerbi-report-author preview --screenshot` captures only the Desktop viewport, so tall / scrolling pages (ActualSize,
FitToWidth) get cut off at the first screen. This script temporarily sets every page's displayOption to FitToPage, reloads
the open Desktop window, captures all pages, then restores the original displayOption values and reloads again.

FOCUS RULE (user 2026-10-12, standing): never steal the user's cursor / focus. The Desktop reload and capture run INSIDE Power BI
Desktop (its preview bridge renders the page and captures it; this script sends no keys, no mouse and no window-activation calls),
but Desktop may still bring itself forward while it re-renders. So:
- The run only starts with --focus-ok, which you pass ONLY after MGR has told you the user gave a moment ("not typing now").
- It reads the foreground window before and after every Desktop call (GetForegroundWindow, read-only). If Desktop takes the
  foreground, it STOPS, restores page.json (files only; the restore reload is skipped so it doesn't happen twice) and exits 3.
  Report FOCUS_CHANGED to MGR; never rerun without a new go.
Prefer the service host for published reports: `preview --host service --headless` renders in a hidden browser and never
touches the Desktop window.

Usage (report must already be open in Power BI Desktop, with nothing unsaved in the REPORT layer you care about):
  python full_page_screenshots.py "C:\\SNOW Logic\\My Report.Report" <out_dir> --focus-ok [--page "Page name"]

Notes:
- Restores page.json files in a finally block, even when the capture fails. Never ask the user to save while it runs.
- If the CLI says HOST_UNAVAILABLE ("no open instance has this report's folder open"), it retries for ~2 minutes; if it still
  fails, ask MGR (the user may need to click into the report canvas once); never click it yourself.
- Tall pages come out small; zoom with the image viewer or crop a region for detail checks (KPI clipping, header alignment).
"""
import ctypes, glob, json, os, subprocess, sys, time

_user32 = ctypes.windll.user32 if os.name == "nt" else None


def foreground_is_desktop():
    """Read-only: is the current foreground window a Power BI Desktop window? (no focus changes)"""
    if not _user32:
        return False
    hwnd = _user32.GetForegroundWindow()
    pid = ctypes.c_ulong()
    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid.value}", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout
    except Exception:
        return False
    return "PBIDesktop" in out


class FocusChanged(Exception):
    pass


def cli(*args, guard=True, started_on_desktop=False):
    r = subprocess.run(["powerbi-report-author", "preview", "--host", "desktop", *args], capture_output=True, text=True, shell=os.name == "nt")
    if guard and not started_on_desktop and foreground_is_desktop():
        raise FocusChanged(f"Desktop took the foreground during: preview {' '.join(args[:1])}")
    return (r.stdout or "") + (r.stderr or "")


def wait_ready(rep, tries=20, **kw):
    for _ in range(tries):
        if "HOST_UNAVAILABLE" not in cli("--status", rep, **kw):
            return True
        time.sleep(6)
    return False


def main():
    if "--focus-ok" not in sys.argv:
        raise SystemExit("Refusing to run: a Desktop reload + capture may bring Power BI Desktop to the front while the user types "
                         "(user rule 2026-10-12). Ask MGR for a moment, then rerun with --focus-ok.")
    rep, out = sys.argv[1], sys.argv[2]
    page = sys.argv[sys.argv.index("--page") + 1] if "--page" in sys.argv else None
    os.makedirs(out, exist_ok=True)
    on_desktop = foreground_is_desktop()       # the user is already in Desktop: nothing to steal
    kw = {"started_on_desktop": on_desktop}
    saved = {}
    for pj in glob.glob(os.path.join(rep, "definition", "pages", "*", "page.json")):
        raw = open(pj, "rb").read()
        d = json.loads(raw.decode("utf-8-sig"))
        if d.get("displayOption") != "FitToPage":
            saved[pj] = raw
            d["displayOption"] = "FitToPage"
            with open(pj, "w", encoding="utf-8", newline="\n") as f:
                json.dump(d, f, indent=2, ensure_ascii=False)
    focus_lost = False
    try:
        if not wait_ready(rep, **kw):
            raise SystemExit("Desktop does not see this report folder (HOST_UNAVAILABLE): ask MGR (the user may need to click into the canvas), then rerun")
        cli("--reload", rep, **kw)
        args = ["--screenshot", os.path.join(out, f"{page}.png") if page else out]
        args += ["--page", page] if page else ["--all-pages"]
        res = ""
        for _ in range(6):                       # the bridge drops the folder for a while after a reload: retry
            time.sleep(10)
            wait_ready(rep, **kw)
            res = cli(*args, rep, **kw)
            if "HOST_UNAVAILABLE" not in res:
                break
        print(res[-300:])
    except FocusChanged as e:
        focus_lost = True
        print(f"FOCUS_CHANGED: {e}. Stopped; tell MGR before running this again.")
    finally:
        for pj, raw in saved.items():
            open(pj, "wb").write(raw)
        if saved and not focus_lost:
            try:
                cli("--reload", rep, **kw)
            except FocusChanged as e:
                focus_lost = True
                print(f"FOCUS_CHANGED during the restore reload: {e}")
        print(f"restored displayOption on {len(saved)} page(s) (files){'' if not focus_lost else '; Desktop NOT reloaded'}; screenshots in {out}")
    if focus_lost:
        sys.exit(3)


if __name__ == "__main__":
    main()
