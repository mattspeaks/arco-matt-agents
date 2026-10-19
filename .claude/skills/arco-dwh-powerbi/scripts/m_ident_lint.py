"""M identifier lint for PBIP models (added 2026-10-15 after a Desktop load failure "M Engine error: Invalid identifier").

TMDL / TmdlSerializer parsing does NOT parse the Power Query M inside partitions and expressions, so an invalid M identifier only
shows up when Desktop opens the project. This lint checks every partition source and shared expression:
- `type table [ ... ]` field names: a bare identifier ([A-Za-z_][A-Za-z0-9_.]* is NOT enough: dots / spaces / dashes need #"...")
  or a quoted identifier #"..." (single quotes are DAX, never M);
- `let` step names: bare identifier or #"...";
- balanced #"..." quoting.
Usage: python m_ident_lint.py <SemanticModel definition folder>   (exit 1 on any finding)"""
import glob, os, re, sys

BARE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*$")
# generalized identifier (record / type field names): words joined by single spaces or dots, e.g. S.No, Column 1
GEN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:[ .][A-Za-z0-9_]+)*$")
QUOTED = re.compile(r'#"(?:[^"]|"")*"$')
KEYWORDS = {"if", "then", "else", "and", "or", "not", "each", "try", "otherwise", "error", "type", "meta", "as", "is"}
STR = re.compile(r'#"(?:[^"]|"")*"|"(?:[^"]|"")*"')


def ident_ok(name, field=False):
    name = name.strip()
    return bool((GEN if field else BARE).match(name) or QUOTED.match(name))


def m_blocks(text):
    """(label, m_text) for each partition source / expression in a TMDL file."""
    out = []
    for m in re.finditer(r"^\t(partition .*?= m|expression .*?=)\n((?:\t\t.*\n|\n(?=\t\t))*)", text, re.M):
        body = "\n".join(l[4:] if l.startswith("\t\t\t\t") else l.strip() for l in m.group(2).split("\n"))
        out.append((m.group(1).strip(), body))
    for m in re.finditer(r"^expression (.+?) =\s*\n((?:\t.*\n|\n(?=\t))*)", text, re.M):
        out.append(("expression " + m.group(1), "\n".join(l.strip() for l in m.group(2).split("\n"))))
    return out


def split_fields(s):
    out, depth, cur, q = [], 0, "", False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            q = not q if not (q and i + 1 < len(s) and s[i + 1] == '"') else q
            if q is True and i + 1 < len(s) and s[i + 1] == '"' and cur.endswith('#'):
                pass
        if not q and c in "[(":
            depth += 1
        if not q and c in "])":
            depth -= 1
        if not q and depth == 0 and c == ",":
            out.append(cur); cur = ""
        else:
            cur += c
        i += 1
    if cur.strip():
        out.append(cur)
    return out


def lint(defn):
    issues = []
    files = glob.glob(os.path.join(defn, "**", "*.tmdl"), recursive=True)
    for p in files:
        text = open(p, encoding="utf-8").read()
        for label, body in m_blocks(text):
            if body.count('#"') and (body.replace('""', "").count('"') % 2):
                issues.append((p, label, "unbalanced quotes"))
            for tt in re.finditer(r"type table \[", body):
                j, depth = tt.end(), 1
                while j < len(body) and depth:
                    depth += {"[": 1, "]": -1}.get(body[j], 0); j += 1
                for f in split_fields(body[tt.end():j - 1]):
                    if "=" not in f:
                        continue
                    name = f.split("=", 1)[0]
                    if not ident_ok(name, field=True):
                        issues.append((p, label, f"type table field {name.strip()!r} needs #\"...\""))
            # blank out M string literals (e.g. multi-line native SQL in [Query="..."]) so their lines aren't read as steps;
            # quoted identifiers #"..." are kept
            code = STR.sub(lambda m: m.group(0) if m.group(0).startswith("#") else '""', body)
            for st in re.finditer(r"(?m)^\s*(#\"(?:[^\"]|\"\")*\"|[^\s=#,(){}\[\]\"]+(?: [^\s=,(){}\[\]\"]+)*)\s*=\s", code):
                nm = st.group(1)
                if nm in ("let", "in") or nm.startswith("//") or nm.startswith("annotation") or nm.split(" ")[0] in KEYWORDS:
                    continue
                if not ident_ok(nm):
                    issues.append((p, label, f"step / field name {nm!r} needs #\"...\""))
    return issues


if __name__ == "__main__":
    found = lint(sys.argv[1])
    for p, label, msg in found:
        print(f"M-IDENT {os.path.basename(p)} | {label} | {msg}")
    print(f"{len(found)} M identifier issue(s)")
    sys.exit(1 if found else 0)
