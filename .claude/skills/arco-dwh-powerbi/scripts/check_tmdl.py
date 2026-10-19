"""TMDL validity check for a PBIP .SemanticModel folder (used by check_pbir.py; also runs standalone).

Usage:
  python check_tmdl.py "C:\\SNOW Logic\\X\\X.SemanticModel"
  python check_tmdl.py "C:\\SNOW Logic\\X\\X.Report"        # follows definition.pbir datasetReference.byPath

1. Real parse (preferred): TmdlSerializer.DeserializeDatabaseFromFolder from the Power BI Desktop install
   (C:\\Program Files\\Microsoft Power BI Desktop\\bin\\Microsoft.PowerBI.Tabular.dll), run through Windows PowerShell
   (pythonnet is not installed here). Override the DLL with env ARCO_TMDL_DLL. A parse failure = ERROR with the parser
   message (the same parser Desktop uses to open the project). ~4 s.
2. Text check (always; the only check when the parser is unavailable; NOT a full parse):
   BOM at file start, `description:` / `description =` property lines (descriptions are /// doc comments above the
   object), tab / space mixing in indentation, an odd number of ``` fences (unterminated expression block),
   em / en dashes in object names. If the real parse succeeded, parse-dependent text findings drop to WARN.
"""
import glob, json, os, re, subprocess, sys

BOM = b"\xef\xbb\xbf"
DLL_DEFAULT = r"C:\Program Files\Microsoft Power BI Desktop\bin\Microsoft.PowerBI.Tabular.dll"
OBJ_RE = re.compile(r"^(\s*)(table|column|measure|hierarchy|level|partition|calculationItem|calculationGroup|role|perspective|"
                    r"expression|relationship|culture|annotation|extendedProperty|model|database|dataSource|queryGroup|function)\b(.*)$")
DESC_RE = re.compile(r"^\s+description\s*[:=]")

_PS = r"""
param([string]$Dll, [string]$Folder)
try { [void][Reflection.Assembly]::LoadFrom($Dll) } catch { Write-Output "NOPARSER: $($_.Exception.Message)"; exit 3 }
try { $db = [Microsoft.AnalysisServices.Tabular.TmdlSerializer]::DeserializeDatabaseFromFolder($Folder); Write-Output "OK $($db.Model.Tables.Count)"; exit 0 }
catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; Write-Output "FAIL: $($e.Message)"; exit 1 }
"""


def model_for_report(report):
    """sibling .SemanticModel of a .Report: definition.pbir byPath, else '<name>.SemanticModel' next to it.
    Returns (path or None, info message or None)."""
    pbir = os.path.join(report, "definition.pbir")
    if os.path.exists(pbir):
        try:
            ref = json.load(open(pbir, encoding="utf-8-sig")).get("datasetReference", {})
        except Exception as e:
            return None, f"TMDL    definition.pbir unreadable ({e}); model not checked"
        if ref.get("byConnection") and not ref.get("byPath"):
            return None, "TMDL    report is bound byConnection (published model): no local TMDL to check"
        p = (ref.get("byPath") or {}).get("path")
        if p:
            p = os.path.normpath(os.path.join(report, p))
            if os.path.isdir(p):
                return p, None
    p = re.sub(r"\.Report$", ".SemanticModel", os.path.normpath(report))
    return (p, None) if os.path.isdir(p) else (None, "TMDL    no local .SemanticModel found next to the report; model not checked")


def parse(defdir):
    """(status, message): status OK / FAIL / NA"""
    dll = os.environ.get("ARCO_TMDL_DLL", DLL_DEFAULT)
    if os.name != "nt" or not os.path.exists(dll):
        return "NA", f"TMDL parser DLL not found ({dll})"
    ps = os.path.join(os.environ.get("TEMP", "."), "arco_tmdl_parse.ps1")
    try:
        if not os.path.exists(ps) or open(ps, encoding="utf-8").read() != _PS:
            open(ps, "w", encoding="utf-8", newline="\n").write(_PS)
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps, dll, defdir],
                           capture_output=True, text=True, timeout=120)
    except Exception as e:
        return "NA", f"TMDL parser could not run ({e})"
    out = (r.stdout or "").strip()
    if r.returncode == 0 and out.startswith("OK"):
        return "OK", out
    if out.startswith("FAIL:"):
        return "FAIL", re.sub(r"\s*\n\s*", " | ", out[5:].strip())
    return "NA", f"TMDL parser unavailable ({(out or r.stderr or '').strip()[:200]})"


def text_check(defdir):
    """(hard, soft): hard = always errors (BOM, dash in names); soft = parse-dependent findings"""
    hard, soft = [], []
    for p in sorted(glob.glob(os.path.join(defdir, "**", "*.tmdl"), recursive=True)):
        raw = open(p, "rb").read()
        rel = os.path.relpath(p, os.path.dirname(defdir))
        if raw.startswith(BOM):
            hard.append(f"TMDL    {rel}: BOM at file start (write UTF-8 without BOM)")
            raw = raw[3:]
        lines = raw.decode("utf-8", "replace").replace("\r\n", "\n").split("\n")
        fences, in_fence, indent_kinds = 0, False, set()
        for i, ln in enumerate(lines, 1):
            n = ln.count("```")
            if n:
                fences += n
                if n % 2:
                    in_fence = not in_fence
                continue
            if in_fence or not ln.strip() or ln.lstrip().startswith("///"):
                continue
            if DESC_RE.match(ln):
                soft.append(f"TMDL    {rel}:{i}: '{ln.strip()[:60]}' is not valid TMDL; put the description as a /// doc comment above the object")
            ws = ln[:len(ln) - len(ln.lstrip())]
            m = OBJ_RE.match(ln)
            if m:
                if ws:
                    indent_kinds.add("tab" if set(ws) == {"\t"} else "space" if set(ws) == {" "} else "mixed")
                if "\u2014" in m.group(3) or "\u2013" in m.group(3):
                    hard.append(f"TMDL    {rel}:{i}: em / en dash in object name '{m.group(3).strip()[:60]}'")
                if " " in ws and "\t" in ws:
                    soft.append(f"TMDL    {rel}:{i}: tabs and spaces mixed in the indentation of '{m.group(2)}'")
        if len(indent_kinds - {"mixed"}) > 1:
            soft.append(f"TMDL    {rel}: object lines indented with both tabs and spaces (use tabs)")
        if fences % 2:
            soft.append(f"TMDL    {rel}: odd number of ``` fences: an expression block is not terminated")
    return hard, soft


def check_model(model):
    """errs, warns, infos for one .SemanticModel folder"""
    errs, warns, infos = [], [], []
    defdir = os.path.join(model, "definition")
    if not os.path.isdir(defdir):
        infos.append(f"TMDL    {model}: no definition folder (model.bim format?); TMDL not checked")
        return errs, warns, infos
    st, msg = parse(defdir)
    hard, soft = text_check(defdir)
    errs += hard
    if st == "FAIL":
        errs.append(f"TMDL    {os.path.basename(model)} does not parse (Desktop will not open it): {msg}")
        errs += soft
    elif st == "OK":
        infos.append(f"TMDL    {os.path.basename(model)} parsed OK with the Desktop TMDL parser")
        warns += soft
    else:
        infos.append(f"TMDL    {msg}; text check only (not a full parse)")
        errs += soft
    return errs, warns, infos


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    tgt = os.path.normpath(sys.argv[1])
    info = None
    if tgt.endswith(".Report"):
        tgt, info = model_for_report(tgt)
    errs, warns, infos = check_model(tgt) if tgt else ([], [], [info])
    for x in infos:
        print("INFO ", x)
    for w in warns:
        print("WARN ", w)
    for e in errs:
        print("ERROR", e)
    print(f"\n{len(errs)} error(s), {len(warns)} warning(s)")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
