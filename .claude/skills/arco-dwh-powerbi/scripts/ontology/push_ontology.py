"""Push Ontology/definition to the live ARCO_Gold_Ontology, keeping the live lineage tags.

updateDefinition matches elements by lineage tag, so freshly generated tags must be replaced with the live
ones (matched by file + object header line, e.g. "entity Project", "\tproperty ProjectNumber").

Renames: RENAMES maps OLD live names to NEW names (entities, backing tables, entity relationships, properties) so a
renamed element keeps its live lineage tag instead of being deleted and recreated. Entries are harmless once the
live definition carries the new names (the old names no longer appear). Add to it before pushing any rename.

    python push_ontology.py            sync tags, then push
    python push_ontology.py --dry-run  sync tags and list elements that would get a NEW tag (no push)
"""
import base64, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # skill scripts/ (fab.py)
import fab

ONTOLOGY_ID = "063432d2-ccff-48d4-b6f6-6243f60f9dd2"
DEF = os.path.join(os.environ.get("ARCO_ONTOLOGY_HOME", os.path.join(os.getcwd(), "Ontology")), "definition")
HEADER = re.compile(r"^(\t*)(entity|property|table|column|entityRelationship|relationship|expression|namespace)\s+(.+?)(\s*=.*)?$")

# 2026-10-08 business-name rename (Director: "rename the ontology entities too and re-push"): source-system names -> business names
RENAMES = {
    "entity": {"GreenhouseJob": "JobRequisition", "GreenhouseDepartment": "RecruitingDepartment",
               "GreenhouseUser": "RecruitingUser", "TexturaProject": "SubcontractorProject",
               "TexturaContract": "SubcontractorContract", "TexturaDraw": "SubcontractorDraw",
               "ConcurUser": "ExpenseUser", "ServiceNowUser": "ITServiceUser"},
    "table": {"Greenhouse_Dim_Department": "Recruiting_Dim_Department"},
    "entityRelationship": {"Textura Project Is Vista Job": "Subcontractor Project For Project",
                           "Contract On Textura Project": "Contract On Subcontractor Project",
                           "Draw On Textura Project": "Draw On Subcontractor Project",
                           "Associate Has ServiceNow Account": "Associate Has IT Service Account",
                           "Concur Account Of Associate": "Expense Account Of Associate",
                           "Job In Greenhouse Department": "Requisition In Recruiting Department",
                           "Associate Has Greenhouse Login": "Associate Has Recruiting Login"},
    "property": {
    "ConcurUserActive": "ExpenseUserActive", "ConcurUserEmployeeNumber": "ExpenseUserEmployeeNumber",
    "ConcurUserStartDate": "ExpenseUserStartDate", "GhAppCandidateNumber": "AppCandidateNumber",
    "GhAppJobNumber": "AppJobNumber", "GhAppJobPostNumber": "AppJobPostNumber",
    "GhAppLastActivityDate": "AppLastActivityDate", "GhAppReferrerNumber": "AppReferrerNumber",
    "GhAppRejectionReasonNumber": "AppRejectionReasonNumber", "GhAppSourceNumber": "AppSourceNumber",
    "GhAppStageName": "AppStageName", "GhAppUpdatedDate": "AppUpdatedDate",
    "GhCandidateCreatedDate": "CandidateCreatedDate", "GhCandidateTimeZone": "CandidateTimeZone",
    "GhCandidateUpdatedDate": "CandidateUpdatedDate", "GhCloseReasonCreatedDate": "CloseReasonCreatedDate",
    "GhCloseReasonUpdatedDate": "CloseReasonUpdatedDate", "GhDeptCreatedDate": "RecDeptCreatedDate",
    "GhDeptDepartmentNumber": "RecDeptDepartmentNumber", "GhDeptUpdatedDate": "RecDeptUpdatedDate",
    "GhJobClosedDate": "ReqClosedDate", "GhJobCompanyNumber": "ReqCompanyNumber",
    "GhJobJobDescription": "ReqJobDescription", "GhOfferApplicationNumber": "OfferApplicationNumber",
    "GhOfferCandidateNumber": "OfferCandidateNumber", "GhOfferCreatedDate": "OfferCreatedDate",
    "GhOfferCreatedDateNumber": "OfferCreatedDateNumber", "GhOfferJobNumber": "OfferJobNumber",
    "GhOfferStartDate": "OfferStartDate", "GhOfferUpdatedDate": "OfferUpdatedDate",
    "GhOfficeCompanyNumber": "OfficeCompanyNumber", "GhOfficeCreatedDate": "OfficeCreatedDate",
    "GhOfficeOfficeName": "HiringOfficeName", "GhOfficeUpdatedDate": "OfficeUpdatedDate",
    "GhOpeningCloseReasonNumber": "OpeningCloseReasonNumber", "GhOpeningClosedDate": "OpeningClosedDate",
    "GhOpeningClosedDateNumber": "OpeningClosedDateNumber", "GhOpeningCreatedDate": "OpeningCreatedDate",
    "GhOpeningJobNumber": "OpeningJobNumber", "GhOpeningOpenedDate": "OpeningOpenedDate",
    "GhOpeningOpenedDateNumber": "OpeningOpenedDateNumber", "GhOpeningOpeningNumber": "OpeningOpeningNumber",
    "GhOpeningUpdatedDate": "OpeningUpdatedDate", "GhReferrerCreatedDate": "ReferrerCreatedDate",
    "GhReferrerUpdatedDate": "ReferrerUpdatedDate", "GhRejReasonCreatedDate": "RejReasonCreatedDate",
    "GhRejReasonUpdatedDate": "RejReasonUpdatedDate", "GhSourceCreatedDate": "SourceCreatedDate",
    "GhSourceUpdatedDate": "SourceUpdatedDate", "GhUserCreatedDate": "RecUserCreatedDate",
    "GhUserUpdatedDate": "RecUserUpdatedDate", "GhUserUserName": "RecruitingUserName",
    "IsGreenhouseUser": "IsRecruitingUser", "SNOWUserKey": "ITServiceUserKey",
    "ServiceNowUserDateCreated": "ITServiceUserDateCreated", "ServiceNowUserIsActive": "ITServiceUserIsActive",
    "TexturaContractDateCreated": "SubContractDateCreated", "TexturaContractDescription": "SubContractDescription",
    "TexturaContractID": "SubContractID", "TexturaDrawDateCreated": "SubDrawDateCreated", "TexturaDrawID": "SubDrawID",
    "TexturaDrawName": "SubDrawName", "TexturaDrawProjectID": "SubDrawProjectID", "TexturaDrawStatus": "SubDrawStatus",
    "TexturaProjectCity": "SubProjectCity", "TexturaProjectCompanyNumbe": "SubProjectCompanyNumber",
    "TexturaProjectCountryCode": "SubProjectCountryCode", "TexturaProjectCounty": "SubProjectCounty",
    "TexturaProjectProjectNumbe": "SubProjectProjectNumber"},
}


def _q(n):
    return f"'{n}'" if re.search(r"[^A-Za-z0-9_]", n) else n


def renamed(kind, name):
    """New header name for a live (kind, name); names may be quoted ('Contract On Textura Project')."""
    new = RENAMES.get(kind, {}).get(name.strip("'"))
    return _q(new) if new else name


def renamed_path(path):
    """entities/<Old>.tmdl -> entities/<New>.tmdl, tables/<Old>.tmdl -> tables/<New>.tmdl."""
    for folder, kind in (("entities/", "entity"), ("tables/", "table")):
        if path.startswith(folder) and path.endswith(".tmdl"):
            stem = path[len(folder):-5]
            return folder + RENAMES[kind].get(stem, stem) + ".tmdl"
    return path


def tag_map(text):
    """{(indent, kind, name): lineageTag} plus the parent chain so properties are scoped to their entity.
    Live names are translated through RENAMES so renamed elements keep their tags."""
    out, stack = {}, []
    for ln in text.split("\n"):
        m = HEADER.match(ln)
        if m:
            depth = len(m.group(1))
            stack = stack[:depth] + [(m.group(2), renamed(m.group(2), m.group(3).strip()))]
            continue
        t = re.match(r"^\t+lineageTag:\s*(\S+)", ln)
        if t and stack:
            out[tuple(stack)] = t.group(1)
    return out


def live_parts():
    resp, b = fab.req(f"{fab.API}/workspaces/{fab.WS}/ontologies/{ONTOLOGY_ID}/getDefinition", "POST", {})
    return {p["path"]: base64.b64decode(p["payload"]).decode("utf-8") for p in fab.lro(resp, b)["definition"]["parts"]}


def sync_tags():
    """Replace generated tags with live ones. Returns (swapped, [elements left with a NEW tag])."""
    live = {renamed_path(p): t for p, t in live_parts().items()}
    swapped, fresh = 0, []
    for d, _, fs in os.walk(DEF):
        for f in fs:
            if not f.endswith(".tmdl"):
                continue
            fp = os.path.join(d, f)
            path = os.path.relpath(fp, DEF).replace(os.sep, "/")
            lmap = tag_map(live[path].replace("\r\n", "\n")) if path in live else {}
            lines, stack, out = open(fp, encoding="utf-8").read().split("\n"), [], []
            for ln in lines:
                m = HEADER.match(ln)
                if m:
                    depth = len(m.group(1))
                    stack = stack[:depth] + [(m.group(2), m.group(3).strip())]
                t = re.match(r"^(\t+lineageTag:\s*)(\S+)", ln)
                if t:
                    if tuple(stack) in lmap:
                        if lmap[tuple(stack)] != t.group(2):
                            ln = t.group(1) + lmap[tuple(stack)]
                            swapped += 1
                    else:
                        fresh.append(f"{path}: {' / '.join(n for _, n in stack)}")
                out.append(ln)
            open(fp, "w", encoding="utf-8", newline="\n").write("\n".join(out))
    return swapped, fresh


def push(dry_run=False):
    swapped, fresh = sync_tags()
    print("lineage tags synced:", swapped, "| elements with a NEW tag (will be created):", len(fresh))
    for x in fresh:
        print("   NEW", x)
    if dry_run:
        return
    resp, b = fab.req(f"{fab.API}/workspaces/{fab.WS}/ontologies/{ONTOLOGY_ID}/updateDefinition", "POST",
                      {"definition": {"parts": fab._parts(DEF)}})
    fab.lro(resp, b); print("update:", resp.status)
    for p, t in sorted(live_parts().items()):
        if p.startswith("entities/"):
            print(p, "props", len(re.findall(r"^\tproperty ", t, re.M)), "descriptions", t.count("///"))


if __name__ == "__main__":
    push(dry_run="--dry-run" in sys.argv)
