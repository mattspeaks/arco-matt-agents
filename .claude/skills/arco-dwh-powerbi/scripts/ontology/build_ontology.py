"""Generate the ARCO Gold ontology definition (writes to $ARCO_ONTOLOGY_HOME/definition; --refresh-inventory re-reads gold columns) (Fabric IQ ontology, TMDL) from the live gold catalog.

Phase 1: shared entities from Gold Shared Dimensions (Project, Company, Vendor, Associate, Department, Date).
Entity, relationship and property-prefix names are BUSINESS names, never the source system (rename pushed 2026-10-08;
old -> new names are in push_ontology.RENAMES so lineage tags carry over). Descriptions may still name the source system.
Backing tables are DirectLake on the gold warehouse (viewer identity / SSO; no stored credential).
Descriptions are merged from a described semantic-model TMDL when available (see DESC_SOURCE).
"""
import json, os, re, sys, uuid, glob

HERE = os.path.dirname(os.path.abspath(__file__))
# working folder for the generated definition + gold_inv.json (default: ./Ontology under the current directory)
WORK = os.environ.get("ARCO_ONTOLOGY_HOME", os.path.join(os.getcwd(), "Ontology"))
OUT = os.path.join(WORK, "definition")
INV_PATH = os.path.join(WORK, "gold_inv.json")


def refresh_inventory():
    """Snapshot gold tables + columns (+ types) to gold_inv.json; run after warehouse schema changes."""
    sys.path.insert(0, os.path.dirname(HERE))
    from fabric_query import connect
    cur = connect("gold").cursor()
    cur.execute("SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY 1, 2")
    tabs = [list(r) for r in cur.fetchall()]
    cur.execute("SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS ORDER BY 1, 2, 5")
    cols = [list(r) for r in cur.fetchall()]
    json.dump({"tables": tabs, "cols": cols, "counts": {}}, open(INV_PATH, "w"))
    print("inventory:", len(tabs), "objects,", len(cols), "columns ->", INV_PATH)


if "--refresh-inventory" in sys.argv or not os.path.exists(INV_PATH):
    refresh_inventory()
INV = json.load(open(INV_PATH))
SERVER = "jpea7wyaqnne3hiyaakbzbit4i-sren67wzqvxuzidngaf3vjto3m.datawarehouse.fabric.microsoft.com"
GOLD_WAREHOUSE_ID = "12ca3037-d961-457b-9029-38ad80cf5d34"
WORKSPACE_ID = "7edf4894-85d9-4c6f-a06d-300bbaa66edb"  # ARCO DWH
import datetime
PINNED = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
# reviewed model description drafts: <root>/<model>/definition/tables/*.tmdl
DESC_ROOT = os.environ.get("ARCO_MODEL_DESCRIPTIONS", os.path.join(os.getcwd(), "Semantic Models", "_staged", "descriptions"))
# entity -> semantic model whose reviewed descriptions it inherits (default: Gold Shared Dimensions)
DESC_MODEL = {"GLAccount": "Gold Financials", "Customer": "Gold Financials", "CostType": "Gold Financials",
              "SubcontractorProject": "Gold Textura", "SubcontractorContract": "Gold Textura", "SubcontractorDraw": "Gold Textura",
              "LeaveCode": "Gold Time Off", "EarnCode": "Gold Payroll", "DeductionCode": "Gold Payroll", "PayPeriod": "Gold Payroll",
              "TaskType": "Gold IT Operations", "ITServiceUser": "Gold IT Operations", "MCPLClient": "Gold Master Client Prospect List",
              "CRMAccount": "Gold Master Client Prospect List", "ProjectSubcontract": "Gold Job Cost",
              "ExpenseReport": "Gold Expenses", "ExpenseUser": "Gold Expenses",
              # phase 4 (2026-10-08)
              "TimeOffRequest": "Gold Time Off", "ProjectFinancialMonth": "Gold Job Cost",
              # 2026-10-08 keyed entities (surrogate keys live in prod gold)
              "APInvoiceLine": "Gold Financials", "UnapprovedAPLine": "Gold Financials", "GLBudgetLine": "Gold Financials",
              "LegalMatter": "Gold Legal",
              # 2026-10-08 orphan links
              "ProjectContract": "Gold Legal",
              # 2026-10-09 phase 6 (Director: "add Textura invoices, payments, Safety and Manpower and anything else we can do")
              **{e: "Gold Textura" for e in ("SubcontractorInvoice", "SubcontractorPayment", "SubcontractorBudgetLine",
                                             "SubcontractorChangeOrder", "LienWaiver")},
              **{e: "Gold Safety" for e in ("SafetyIncident", "SafetyInjury", "NearMiss", "ManpowerLog", "SafetyInspection",
                                            "SafetyObservation", "Submittal")},
              **{e: "Gold Job Cost" for e in ("PrimeContract", "WorkOrderContract", "InsuranceCompliance", "ProjectCarryforward")},
              "ExpenseEntry": "Gold Expenses", "LegalClaim": "Gold Legal", "ClientProtection": "Gold Master Client Prospect List",
              # 2026-10-09 IT time (Director: "add them"; stable hash keys live in prod gold 2026-10-09 20:25 UTC)
              "ITTicketTimeWorked": "Gold IT Operations", "ITTimeCardEntry": "Gold IT Operations",
              **{e: "Gold Talent Acquisition" for e in ("JobRequisition", "RecruitingDepartment", "Office", "RecruitingUser", "Source",
                                                "Referrer", "RejectionReason", "CloseReason", "Candidate", "Application",
                                                "Offer", "Opening")}}
# backing-table name when two entities' gold tables share a name (partition entityName/schemaName still point at gold)
TABLE_ALIAS = {"RecruitingDepartment": "Recruiting_Dim_Department"}
# short prefix used instead of the entity name when a later entity's property name collides (keeps names <= 26 chars).
# Business prefixes only, never a source-system abbreviation (2026-10-08 rename: Gh... -> Req / RecDept / RecUser / entity names).
PREFIX = {"ProjectFinancialMonth": "Pfm", "TimeOffRequest": "TimeOff", "JobRequisition": "Req",
          "RecruitingDepartment": "RecDept", "Office": "Office", "RecruitingUser": "RecUser", "Source": "Source",
          "Referrer": "Referrer", "RejectionReason": "RejReason", "CloseReason": "CloseReason",
          "Candidate": "Candidate", "Application": "App", "Offer": "Offer", "Opening": "Opening",
          "SubcontractorProject": "SubProject", "SubcontractorContract": "SubContract", "SubcontractorDraw": "SubDraw",
          "APInvoiceLine": "APLine", "UnapprovedAPLine": "UnapprovedAP", "GLBudgetLine": "Budget", "LegalMatter": "Matter",
          "ProjectContract": "Contract",
          # 2026-10-09 phase 6
          "SubcontractorInvoice": "SubInvoice", "SubcontractorPayment": "SubPayment", "SubcontractorBudgetLine": "SubBudget",
          "SubcontractorChangeOrder": "SubChangeOrder", "LienWaiver": "LienWaiver", "SafetyIncident": "Incident",
          "SafetyInjury": "Injury", "NearMiss": "NearMiss", "ManpowerLog": "Manpower", "SafetyInspection": "Inspection",
          "SafetyObservation": "Observation", "Submittal": "Submittal", "PrimeContract": "Prime",
          "WorkOrderContract": "WorkOrder", "InsuranceCompliance": "Insurance", "ProjectCarryforward": "Carryforward",
          "ExpenseEntry": "ExpenseEntry", "LegalClaim": "Claim", "ClientProtection": "Protection",
          # 2026-10-09 IT time
          "ITTicketTimeWorked": "TicketTime", "ITTimeCardEntry": "TimeCard"}
# explicit property names (entity, gold column) -> name, for columns whose clean name carries a system abbreviation
# but are NOT crosswalk IDs. Crosswalk IDs keep the system (ProcoreEmployeeID, ConcurEmployeeID, ServiceNowSysId,
# SNOWSysId, GreenhouseUserNumber, ProcoreVendorID, ViewpointEmployeeID, UKGEarnCode...) because the system is what the value identifies.
PROP_NAME = {("ITServiceUser", "SNOW User Key"): "ITServiceUserKey", ("Referrer", "Is Greenhouse User"): "IsRecruitingUser",
             ("Office", "Office Name"): "HiringOfficeName", ("RecruitingUser", "User Name"): "RecruitingUserName",
             # 2026-10-08 keyed entities: readable names instead of prefixed / truncated ones
             ("APInvoiceLine", "Line"): "APLineNumber",
             ("UnapprovedAPLine", "AP Company"): "UnapprovedAPCompany", ("UnapprovedAPLine", "Accounting Month"): "UnapprovedAPMonth",
             ("UnapprovedAPLine", "Line"): "UnapprovedAPLineNumber", ("UnapprovedAPLine", "AP Unapproved Line Key"): "UnapprovedAPLineKey",
             ("LegalMatter", "Negotiation Complexity Rating"): "NegotiationComplexity",
             ("LegalMatter", "Should Trigger Matter Event Rules"): "TriggersMatterEventRules",
             # 2026-10-08 orphan links: untruncated names; Arco On Contract holds the signing company number (as text)
             ("ProjectContract", "Arco On Contract"): "SigningCompanyNumber",
             ("ProjectContract", "Single Contract Summary Waived"): "ContractSummaryWaived",
             ("ProjectContract", "Single Data Validation Complete"): "DataValidationComplete",
             ("ProjectContract", "Single Field Audit Complete"): "FieldAuditComplete",
             # 2026-10-09 phase 6: readable keys (Procore 'Procore Id' would clash case-insensitively with Project ProcoreID)
             ("SubcontractorInvoice", "ID"): "SubInvoiceID", ("SubcontractorPayment", "ID"): "SubPaymentID",
             ("SubcontractorBudgetLine", "ID"): "SubBudgetID", ("SubcontractorChangeOrder", "ID"): "SubChangeOrderID",
             ("LienWaiver", "ID"): "LienWaiverID",
             ("SubcontractorInvoice", "Draw ID"): "SubInvoiceDrawID", ("SubcontractorInvoice", "Contract ID"): "SubInvoiceContractID",
             ("SubcontractorPayment", "Draw ID"): "SubPaymentDrawID", ("SubcontractorPayment", "Contract ID"): "SubPaymentContractID",
             ("SubcontractorPayment", "Project ID"): "SubPaymentProjectID",
             ("LienWaiver", "Draw ID"): "LienWaiverDrawID", ("LienWaiver", "Contract ID"): "LienWaiverContractID",
             ("SubcontractorChangeOrder", "Contract ID"): "SubChangeOrderContractID",
             ("SubcontractorBudgetLine", "Contract ID"): "SubBudgetContractID",
             ("SafetyIncident", "Procore Id"): "IncidentID", ("SafetyInjury", "Procore Id"): "InjuryID",
             ("NearMiss", "Procore Id"): "NearMissID",
             ("SafetyInjury", "Incident Id"): "InjuryIncidentID", ("NearMiss", "Incident Id"): "NearMissIncidentID",
             ("SafetyIncident", "Project Id"): "IncidentProcoreProjectID", ("SafetyInjury", "Project Id"): "InjuryProcoreProjectID",
             ("NearMiss", "Project Id"): "NearMissProcoreProjectID", ("SafetyInspection", "Project Id"): "InspectionProcoreProjectID",
             ("ManpowerLog", "Project Number"): "ManpowerProcoreProjectID", ("ManpowerLog", "Vendor Number"): "ManpowerProcoreVendorID",
             ("SafetyObservation", "Project Number"): "ObsProcoreProjectID",
             ("Submittal", "Project Number"): "SubmittalProcoreProjectID",
             ("SafetyInspection", "id"): "InspectionID", ("InsuranceCompliance", "Assignment Id"): "InsuranceAssignmentID",
             ("ProjectCarryforward", "Project Number"): "CarryforwardProjectNumber", ("LegalClaim", "Matter Guid"): "ClaimMatterGuid",
             ("WorkOrderContract", "Signed Contract Received Date"): "WorkOrderSignedRcvdDate",
             ("WorkOrderContract", "Draft Change Orders Amount"): "WorkOrderDraftCOAmt",
             ("ExpenseEntry", "Expense Report Number"): "ExpenseEntryReportNumber",
             ("SubcontractorInvoice", "Subcontracted Material Stored This Period"): "SubconMatlStoredThisPeriod",
             ("SubcontractorBudgetLine", "Self Change Order Amount"): "SubBudgetSelfCOAmount",
             ("SubcontractorBudgetLine", "Subcontracted Billed To Date"): "SubBudgetSubconBilled",
             ("LienWaiver", "Conditional Lien Waiver Compliance Code"): "CondWaiverComplianceCode",
             ("LienWaiver", "Unconditional Lien Waiver Compliance Code"): "UncondWaiverComplianceCode",
             ("LienWaiver", "Unconditional Lien Waiver Release Date"): "UncondWaiverReleaseDate",
             ("SafetyInspection", "Default Response Phrasing Deficient Response"): "DefaultDeficientResponse",
             ("SafetyInspection", "Default Response Phrasing Conforming Response"): "DefaultConformingResponse",
             ("SafetyObservation", "Contributing Condition Name"): "ObsContribConditionName",
             ("SafetyObservation", "Contributing Behavior Name"): "ObsContribBehaviorName",
             ("SafetyObservation", "Location Node Name"): "ObsLocationNodeName",
             ("SafetyInjury", "Type"): "InjuryType", ("ManpowerLog", "Date"): "ManpowerDate",
             ("ProjectCarryforward", "Month"): "CarryforwardMonth",
             ("WorkOrderContract", "Remaining Balance Outstanding"): "RemainingBalance",
             ("PrimeContract", "Project ID"): "PrimeProcoreProjectID", ("WorkOrderContract", "Project ID"): "WorkOrderProcoreProjectID",
             ("PrimeContract", "Vendor ID"): "PrimeProcoreVendorID", ("WorkOrderContract", "Vendor ID"): "WorkOrderProcoreVendorID",
             # 2026-10-09 IT time: every property pinned so ticket work-log and time card columns never read alike
             ("ITTicketTimeWorked", "Task Time Worked Key"): "TicketTimeWorkedKey",
             ("ITTicketTimeWorked", "Task Time Worked Sys Id"): "TicketTimeWorkedSysId",
             ("ITTicketTimeWorked", "Date Key"): "TicketTimeDateKey", ("ITTicketTimeWorked", "SNOW User Key"): "TicketTimeUserKey",
             ("ITTicketTimeWorked", "SNOW Sys Id"): "TicketTimeUserSysId", ("ITTicketTimeWorked", "Task Type Key"): "TicketTimeTaskTypeKey",
             ("ITTicketTimeWorked", "Task Sys Id"): "TicketSysId", ("ITTicketTimeWorked", "Task Number"): "TicketNumber",
             ("ITTicketTimeWorked", "Time In Seconds"): "TicketTimeSeconds", ("ITTicketTimeWorked", "Rate Type"): "TicketTimeRateType",
             ("ITTimeCardEntry", "Time Entry Key"): "TimeCardEntryKey", ("ITTimeCardEntry", "Date Key"): "TimeCardDateKey",
             ("ITTimeCardEntry", "SNOW User Key"): "TimeCardUserKey", ("ITTimeCardEntry", "SNOW Sys Id"): "TimeCardUserSysId",
             ("ITTimeCardEntry", "Task Type Key"): "TimeCardTaskTypeKey", ("ITTimeCardEntry", "Task Sys Id"): "TimeCardTaskSysId",
             ("ITTimeCardEntry", "Task Number"): "TimeCardTaskNumber", ("ITTimeCardEntry", "Task Short Description"): "TimeCardTaskDescription",
             ("ITTimeCardEntry", "Top Project Key"): "TimeCardITProjectKey", ("ITTimeCardEntry", "Top Project Sys Id"): "TimeCardITProjectSysId",
             ("ITTimeCardEntry", "Top Project Number"): "ITProjectNumber", ("ITTimeCardEntry", "Time Card Sys Id"): "TimeCardSysId",
             ("ITTimeCardEntry", "Time Sheet Sys Id"): "TimeSheetSysId", ("ITTimeCardEntry", "Category"): "TimeCardCategory",
             ("ITTimeCardEntry", "Allocation Method"): "TimeCardAllocationMethod", ("ITTimeCardEntry", "State"): "TimeCardState",
             ("ITTimeCardEntry", "Hours"): "TimeCardHours", ("ITTimeCardEntry", "Approved By SNOW Sys Id"): "TimeCardApproverSysIds",
             ("ITTimeCardEntry", "Approved On"): "TimeCardApprovedOn"}
# business lead sentence put in front of the model's table description (entity names are business terms, 2026-10-08)
LEAD = {
    "JobRequisition": "Job requisition: a recruiting job opened to hire for a role (from Greenhouse); not a construction job (see Project).",
    "RecruitingDepartment": "Recruiting department: the department a job requisition sits in (from Greenhouse); not the project stage lookup.",
    "RecruitingUser": "Recruiting user: ARCO staff with a recruiting system (Greenhouse) login, such as recruiters, coordinators and interviewers.",
    "SubcontractorProject": "Subcontractor project: a project set up for subcontractor pay applications (from Textura), cross-walked to the Vista job.",
    "SubcontractorContract": "Subcontractor contract: one owner-facing General Construction roll-up per subcontractor project plus one contract per subcontract (from Textura).",
    "SubcontractorDraw": "Subcontractor draw: one billing period (pay period, usually monthly) of a subcontractor project (from Textura).",
    "ExpenseUser": "Expense user: an expense system (Concur) user account.",
    "ITServiceUser": "IT service user: an IT service management (ServiceNow) user account.",
    # 2026-10-08 keyed entities: facts verified in prod gold the same day
    "APInvoiceLine": ("AP invoice line: one approved (posted) accounts payable invoice line from Vista AP (3,857,647 rows, "
                      "accounting months June 2009 to December 2026). Key APLineKey ('<AP Company>|<yyyymmdd accounting month>|"
                      "<AP transaction>|<line>'), unique and never blank. Amounts are additive dollars (Gross Amount includes tax). "
                      "Invoice notes are excluded as sensitive."),
    "UnapprovedAPLine": ("Unapproved AP line: one invoice line still waiting in the Vista unapproved-invoice review queue "
                         "(current snapshot, 9,144 rows on 2026-10-08; not history). Key UnapprovedAPLineKey ('<AP Company>|"
                         "<yyyymmdd accounting month>|<UI seq>|<line>'), unique and never blank. Invoice notes are excluded as sensitive."),
    "GLBudgetLine": ("GL budget line: one annual Vista GL budget amount for a company + GL account + fiscal year + budget code "
                     "(44,181 rows, fiscal years 2009 to 2026; 25,620 rows are the latest version). Key BudgetKey ('<company>|"
                     "<GL account>|<fiscal year>|<budget code>|<version>'), unique and never blank. Use only rows with "
                     "IsLatest = 1 for current budgets."),
    "LegalMatter": ("Legal matter: one in-house legal matter or intake request from CounselLink (7,387 rows: 7,338 'Matter' and "
                    "49 'Intake'). Key MatterKey ('<Matter Guid>|<Matter Category>'), unique and never blank; Matter Guid alone "
                    "is NOT unique because an intake and the matter it became share a GUID. Count matters with "
                    "MatterCategory = 'Matter'. Title and Description are CONFIDENTIAL free text: never quote or list them."),
    # 2026-10-08 orphan links: facts verified in prod gold the same day
    "ProjectContract": ("Project contract: the legal contract terms of one prime contract matter in CounselLink (insurance, bonding, "
                        "licensing, retention, waivers, schedule and Legal review milestones; 4,245 rows, one per contract matter). "
                        "Key ContractMatterGuid (the matter's GUID), unique and never blank. Linked to its legal matter and, through the "
                        "Vista job number, to its project; a project can have more than one contract matter. Contract Value, Project "
                        "Value and the free-text clause columns are CONFIDENTIAL: aggregate only. Never surface details of Secret or "
                        "Top-Secret contracts (Confidentiality Level)."),
    # 2026-10-09 phase 6: facts verified in prod gold the same day
    "SubcontractorInvoice": ("Subcontractor invoice: one subcontractor pay application for one subcontractor contract in one draw "
                             "(Textura; 69,008 rows, submit dates April 2024 to October 2026). Key SubInvoiceID, unique and never blank. "
                             "Exclude the owner-facing General Construction contract's pay apps (contract with a blank vendor) for "
                             "subcontractor cost."),
    "SubcontractorPayment": ("Subcontractor payment: one payment to a subcontractor through Textura (48,296 rows, paid July 2024 "
                             "to October 2026). Key SubPaymentID, unique and never blank. Sum Payment Amount; never sum the running "
                             "balances (Invoice Paid To Date, Remaining Amount)."),
    "SubcontractorBudgetLine": ("Subcontractor budget line: one schedule-of-values line of a subcontractor contract with to-date "
                                "totals (Textura; 140,698 rows). Key SubBudgetID, unique and never blank."),
    "SubcontractorChangeOrder": ("Subcontractor change order: one change order on a subcontractor contract (Textura; 31,945 rows). "
                                 "Key SubChangeOrderID, unique and never blank."),
    "LienWaiver": ("Lien waiver: lien waiver compliance for one subcontractor contract in one draw, or for a sub-tier supplier in a "
                   "draw (Textura; 168,902 rows). Key LienWaiverID, unique and never blank."),
    "SafetyIncident": ("Safety incident: one incident recorded in the Procore Incidents tool (4,565 rows, events August 2019 onward). "
                       "Key IncidentID (the Procore incident id), unique and never blank. Count incidents; there are no amounts. "
                       "Incident narratives are excluded as sensitive."),
    "SafetyInjury": ("Safety injury: one injury record on a safety incident (1,347 rows; 353 OSHA recordable). Key InjuryID, unique "
                     "and never blank. SENSITIVE (OSHA injury record): report counts only, never list individual cases; narratives "
                     "are excluded. Use Recordable for recordable counts."),
    "NearMiss": ("Near miss: one near-miss record on a safety incident (510 rows). Key NearMissID, unique and never blank. Count "
                 "near misses here, not from the incident type text. Narratives are excluded as sensitive."),
    "ManpowerLog": ("Manpower log: one daily-log manpower line, a company's crew size and hours on a project for one day (Procore; "
                    "1,920,263 rows, 2011 to today). Key ManpowerLogID, unique and never blank. Sum ManHours (= workers x hours) "
                    "and NumWorkers; never sum NumHours. Report approved lines (ManpowerStatus = 'approved')."),
    "SafetyInspection": ("Safety inspection: one inspection checklist on a project (Procore; 138,102 rows; about 92% safety "
                         "inspections). Key InspectionID (the Procore id), unique and never blank."),
    "SafetyObservation": ("Safety observation: one observation raised on a project, such as a safety hazard, quality deficiency or "
                          "punch item (Procore; 98,482 rows). Key ObservationID, unique and never blank."),
    "Submittal": ("Submittal: one revision of a project submittal such as shop drawings, product data or samples (Procore; 217,126 "
                  "rows). Key SubmittalID, unique and never blank. Count current submittals with CurrentRevision = true."),
    "PrimeContract": ("Prime contract: one Procore prime contract with the owner / client (6,408 rows, current state). Key "
                      "PrimeContractID, unique and never blank. Filter Status to Approved / Complete before summing contract value; "
                      "for contract value Vista WIP comes first (ProjectFinancialMonth), approved Procore prime is the fallback."),
    "WorkOrderContract": ("Commitment (work order contract): one Procore subcontract or purchase order with a vendor (73,604 rows, "
                          "current state). Key WorkOrderContractID, unique and never blank. Exclude Void and Draft before summing."),
    "InsuranceCompliance": ("Insurance compliance: whether one active Vista subcontract's certificates of insurance meet its "
                            "requirements, and when the earliest policy expires (myCOI; 5,211 rows). Key InsuranceAssignmentID, unique "
                            "and never blank; Contract Unique Id (the Vista subcontract) is unique too."),
    "ProjectCarryforward": ("Project carryforward: year-end profit carryforward settings of one job (Vista; 1,093 jobs). Key "
                            "CarryforwardProjectNumber (the Vista job number), unique and never blank. The values are FRACTIONS "
                            "(0.64 = 64%), never dollars; never sum them."),
    "ExpenseEntry": ("Expense line: one line of a submitted expense report (Concur; 1,644,875 rows). Key ExpenseEntryNumber, unique "
                     "and never blank. Sum Expense Amount, but exclude 'Child' itemization rows for report totals (or 'Parent' rows "
                     "for expense-type detail). The employee's free-text purpose is excluded as personal data."),
    "LegalClaim": ("Legal claim: the claim detail of one claims legal matter (CounselLink; 1,306 rows). Key ClaimMatterGuid (the "
                   "matter's GUID), unique and never blank. CONFIDENTIAL and privileged: claim values, payor, defense and offense "
                   "amounts are legal reserves; aggregate only, never list per claim or next to a party name. The claim "
                   "narrative is excluded."),
    "ClientProtection": ("Client protection: one ARCO company's claim (right to pursue) on one client or prospect (ARCO Hub; 5,826 "
                         "rows). Key ProtectionRecordID, unique and never blank. Count clients distinctly: a client can hold several "
                         "protections."),
    # 2026-10-09 IT time: facts verified in prod gold the same day (after the 20:25 UTC ServiceNow rebuild)
    "ITTicketTimeWorked": ("IT ticket time worked: one work-log time entry a person logged on an IT support ticket (incident, "
                           "catalog task or requested item) in ServiceNow (436,567 rows, 214 people, 184,460 tickets; 2022-08-11 to "
                           "2026-10-08). Key TicketTimeWorkedSysId (the ServiceNow work-log sys_id), unique and never blank. Hours = "
                           "sum of TicketTimeSeconds / 3600. This is NOT time card time: never add it to ITTimeCardEntry hours (different "
                           "capture, different people). Work notes and employee IDs are excluded as personal data."),
    "ITTimeCardEntry": ("IT time card entry: one day of one weekly ServiceNow time card line (one person, one week, one task or "
                        "category), split by task type (42,120 rows, 77 people, 11,798 time cards; work dates 2025-12-28 to 2026-10-30, "
                        "future dates are planned time off). Key TimeCardEntryKey, a stable hash of time card + work date + task type, "
                        "unique and never blank. Sum TimeCardHours; filter TimeCardState to Approved + Processed for approved time. This "
                        "is NOT ticket work-log time: never add it to ITTicketTimeWorked. ITProjectNumber is a ServiceNow IT project "
                        "(PRJ + 7 digits), not a Vista construction project. Employee IDs are excluded as personal data."),
}
# extra column notes (entity, gold column) -> text: descriptions for new key columns the published models do not carry yet,
# and Sensitive flags on business free text the models keep (PII policy, gold-semantic-models.md)
COL_NOTE = {
    ("APInvoiceLine", "AP Line Key"): "Primary key of the AP invoice line: '<AP Company>|<yyyymmdd accounting month>|<AP transaction>|<line>', e.g. 2|20191001|405|1; unique, never blank.",
    ("APInvoiceLine", "Description"): "Sensitive: business free text; summarize, do not list values.",
    ("UnapprovedAPLine", "AP Unapproved Line Key"): "Primary key of the unapproved AP line: '<AP Company>|<yyyymmdd accounting month>|<UI seq>|<line>', e.g. 80|20260901|6|1; unique, never blank.",
    ("UnapprovedAPLine", "Description"): "Sensitive: business free text; summarize, do not list values.",
    ("UnapprovedAPLine", "Responsible Person"): "Sensitive: personal name.",
    ("UnapprovedAPLine", "Next Reviewer"): "Sensitive: personal name.",
    ("GLBudgetLine", "Budget Key"): "Primary key of the budget line: '<company>|<GL account>|<fiscal year>|<budget code>|<version>'; unique, never blank.",
    ("LegalMatter", "Matter Key"): "Primary key of the matter or intake: '<Matter Guid>|<Matter Category>'; unique, never blank (Matter Guid alone repeats for an intake and its matter).",
    ("LegalMatter", "Description"): "Sensitive.",
    ("LegalMatter", "Title"): "Sensitive.",
    ("ProjectContract", "Matter Guid"): "Primary key of the project contract: the CounselLink matter GUID; unique, never blank (4,245 rows).",
    ("ProjectContract", "Contract Value"): "Confidential commercial data; aggregate only.",
    ("ProjectContract", "Project Value"): "Confidential commercial data; aggregate only.",
    ("ProjectContract", "License Number"): "Sensitive.",
    ("ProjectContract", "Partial Waiver Details"): "Sensitive: confidential contract terms; summarize, do not quote.",
    ("ProjectContract", "Retention Details"): "Sensitive: confidential contract terms; summarize, do not quote.",
    ("ProjectContract", "Project Milestones"): "Sensitive: contract free text; summarize, do not quote.",
    # 2026-10-09 phase 6
    ("SubcontractorInvoice", "Draw ID"): "Holds the SubcontractorDraw ID as text (100% match after conversion): to find the draw, look up the SubcontractorDraw whose SubDrawID equals this number.",
    ("SubcontractorInvoice", "Contract ID"): "Holds the SubcontractorContract ID as text (100% match after conversion): to find the contract (and its vendor), look up the SubcontractorContract whose SubContractID equals this number.",
    ("SubcontractorPayment", "Draw ID"): "Holds the SubcontractorDraw ID as text (100% match after conversion): look up the SubcontractorDraw whose SubDrawID equals this number.",
    ("SubcontractorPayment", "Contract ID"): "Holds the SubcontractorContract ID as text (100% match after conversion): look up the SubcontractorContract whose SubContractID equals this number.",
    ("SubcontractorPayment", "Project ID"): "Holds the SubcontractorProject ID as text (100% match after conversion).",
    ("LienWaiver", "Draw ID"): "Holds the SubcontractorDraw ID as text (99.9% of non-blank match after conversion).",
    ("LienWaiver", "Contract ID"): "Holds the SubcontractorContract ID as text; blank on sub-tier rows (99.4% of non-blank match after conversion).",
    ("SubcontractorChangeOrder", "Contract ID"): "Holds the SubcontractorContract ID as text (96.9% of non-blank match after conversion).",
    ("SafetyIncident", "Procore Id"): "Primary key: the Procore incident id; unique, never blank.",
    ("SafetyIncident", "Project Id"): "This is the PROCORE project id, not the Vista job number; linked to Project through 'Incident On Project' (Project ProcoreID; 97.3%, 4,445 of 4,568 incidents on 2026-10-11).",
    ("SafetyIncident", "Title"): "Sensitive: can name people or describe injuries; do not list.",
    ("SafetyIncident", "Created By Name"): "Sensitive: personal name.",
    ("SafetyInjury", "Procore Id"): "Primary key: the Procore injury record id; unique, never blank.",
    ("SafetyInjury", "Project Id"): "This is the PROCORE project id, not the Vista job number: look up the Project whose ProcoreID equals it (96.7% match).",
    ("SafetyInjury", "Incident Title"): "Sensitive: can name people or describe injuries; do not list.",
    ("SafetyInjury", "Incident Created By Name"): "Sensitive: personal name.",
    ("NearMiss", "Procore Id"): "Primary key: the Procore near-miss record id; unique, never blank.",
    ("NearMiss", "Project Id"): "This is the PROCORE project id, not the Vista job number: look up the Project whose ProcoreID equals it (98.4% match).",
    ("NearMiss", "Incident Title"): "Sensitive: can name people; do not list.",
    ("NearMiss", "Incident Created By Name"): "Sensitive: personal name.",
    ("ManpowerLog", "Project Number"): "This is the PROCORE project id as text, not the Vista job number (0% match to Project Number): look up the Project whose ProcoreID equals it (99.3% match).",
    ("ManpowerLog", "Vendor Number"): "This is the PROCORE vendor id as text, not the Vista vendor number: look up the Vendor whose ProcoreVendorID equals it (69.7% of non-blank match).",
    ("ManpowerLog", "Created By Name"): "Sensitive: personal name.",
    ("SafetyInspection", "id"): "Primary key: the Procore inspection id; unique, never blank.",
    ("SafetyInspection", "Project Id"): "This is the PROCORE project id, not the Vista job number; linked to Project through 'Inspection On Project' (Project ProcoreID; 95.9%, 132,571 of 138,257 inspections on 2026-10-11).",
    ("SafetyInspection", "Description"): "Sensitive: may contain names; do not list.",
    ("SafetyObservation", "Project Number"): "This is the PROCORE project id as text, not the Vista job number: look up the Project whose ProcoreID equals it (99.2% match).",
    ("SafetyObservation", "Description"): "Sensitive: can name people or describe injuries; do not list.",
    ("Submittal", "Project Number"): "This is the PROCORE project id as text, not the Vista job number: look up the Project whose ProcoreID equals it (97.8% match).",
    ("ExpenseEntry", "Vendor Name"): "Sensitive: merchant free text typed by the employee.",
    ("ManpowerLog", "Company Number"): "Procore company account id (constant 39265), not a Vista company number.",
    ("SafetyIncident", "Company Id"): "Procore company account id (constant), not a Vista company number.",
    ("SafetyInspection", "Company Id"): "Procore company account id (constant), not a Vista company number.",
    ("SafetyObservation", "Company Number"): "Procore company account id (constant), not a Vista company number.",
    ("Submittal", "Company Number"): "Procore company account id (constant), not a Vista company number.",
    ("WorkOrderContract", "Company ID"): "Procore company account id (constant), not a Vista company number.",
    ("PrimeContract", "Project ID"): "PROCORE project id (matches the Project's ProcoreID on 89.6%); use Project Number for the Vista job.",
    ("WorkOrderContract", "Project ID"): "PROCORE project id; use Project Number for the Vista job.",
    ("PrimeContract", "Vendor ID"): "PROCORE directory id of the owner / client company, not a Vista vendor number.",
    ("WorkOrderContract", "Vendor ID"): "PROCORE vendor id, not the Vista vendor number: look up the Vendor whose ProcoreVendorID equals it (75.7% of non-blank match).",
    # 2026-10-09 IT time (columns added in the 2026-10-09 ServiceNow rebuild; the published model does not carry them yet)
    ("ITTicketTimeWorked", "Task Time Worked Sys Id"): "Primary key: the ServiceNow work-log (task_time_worked) sys_id, 32-character hex; unique, never blank (436,567 rows on 2026-10-09).",
    ("ITTicketTimeWorked", "SNOW User Key"): "Hash key of the ServiceNow user who logged the time (bigint, stable); equals the ITServiceUser's ITServiceUserKey (100% of non-blank; blank on 8 rows).",
    ("ITTimeCardEntry", "SNOW User Key"): "Hash key of the ServiceNow user who logged the time (bigint, stable); equals the ITServiceUser's ITServiceUserKey (100% of non-blank; blank on 1 row).",
    ("ITTimeCardEntry", "Top Project Key"): ("Hash key of the ServiceNow IT project above the task (bigint, stable; set on 24,599 rows, 100% resolve to the IT "
                                             "project list). IT projects are not an ontology entity yet, so there is no declared link: group by ITProjectNumber. "
                                             "Not a Vista construction project."),
    ("ITTimeCardEntry", "Task Short Description"): "Sensitive: free text that can contain names or email addresses; do not quote it in answers about individuals.",
}
# full description overrides (entity, gold column) -> text, replacing the merged model description (2026-10-09: the model text
# pointed at a restricted table that is not in the ontology)
COL_DESC = {
    ("TimeOffRequest", "Employee ID"): ("UKG employee ID, 12-character text; never blank. It is NOT the associate directory's Employee "
                                        "Number (0% match). To reach the Associate entity, match Payroll Company + Viewpoint Employee "
                                        "ID to the associate's Company Code + Viewpoint Employee ID (2,674 of 2,690 requesters, 99.4%)."),
    # 2026-10-09 ServiceNow rebuild: the published model still describes the old ROW_NUMBER keys
    ("ITServiceUser", "SNOW User Key"): ("Surrogate key: SHA-256 hash of the ServiceNow user sys_id (bigint), stable across daily loads since the "
                                         "2026-10-09 rebuild; unique. The IT time entities carry it as TicketTimeUserKey / TimeCardUserKey. The "
                                         "entity key is SNOWSysId."),
    ("ITTicketTimeWorked", "Task Time Worked Key"): ("Surrogate key: SHA-256 hash of the work-log sys_id (bigint), stable across daily loads; "
                                                     "unique. The entity key is TicketTimeWorkedSysId."),
    ("ITTicketTimeWorked", "SNOW Sys Id"): ("ServiceNow sys_id of the person who logged the time (32-character hex); the link to ITServiceUser "
                                            "(100% of non-blank; blank on 8 rows, 2.17 hours, which belong to no person)."),
    ("ITTimeCardEntry", "Time Entry Key"): ("Primary key: SHA-256 hash (bigint) of time card sys_id | work date | task type code; the same inputs "
                                            "give the same key on every daily load; unique, never blank (42,120 rows on 2026-10-09)."),
    ("ITTimeCardEntry", "SNOW Sys Id"): ("ServiceNow sys_id of the person who logged the time (32-character hex); the link to ITServiceUser "
                                         "(100% of non-blank; blank on 1 row, 0.25 hours, which belongs to no person)."),
}
# extra sentences appended to a column description even when the model has one (short guidance)
COL_ADD = {
    ("TimeOffRequest", "Payroll Company"): "With Viewpoint Employee ID it finds the associate: match the associate's Company Code + Viewpoint Employee ID (99.4% of requesters).",
    ("TimeOffRequest", "Viewpoint Employee ID"): "To find the associate, match Payroll Company + this ID to the associate's Company Code + Viewpoint Employee ID (99.4% of requesters).",
    ("Company", "Division Type"): "A classification of the company, NOT the Division: in Family > Division the Division is the company itself ('<number> - <legal name>'). Group by it only when the user asks for division type.",
    ("Project", "Office Division"): "Procore office division, NOT the Family > Division grouping (that comes from the controlling company).",
    ("SubcontractorInvoice", "Self Billed Amount This Period"): "Gross billed this period (before retention): compare this with Vista approved AP.",
    ("SubcontractorInvoice", "Net Invoice Amount"): "After retention: lower than Vista approved AP by the retention held.",
}
# per-entity sentences to drop from merged table descriptions (model joins to tables that are not ontology entities)
DESC_DROP = {
    "TimeOffRequest": [r"\[Employee ID\] to Dim_Associate \([^)]*\);\s*", r"[^.]*Dim_Manager rollups work through Dim_Associate\.\s*"],
    # 2026-10-09 IT time: the model text predates the stable keys (and the counts are refreshed in LEAD)
    "ITTicketTimeWorked": [r"\s*\(435,728 rows[^)]*\)", r"No natural key:[^.]*\.\s*", r"\(5\) \[Comments\][^.]*\.\s*",
                           r"\s*\(6\) \[Task Time Worked Key\] is renumbered at every daily load\."],
    "ITTimeCardEntry": [r"\s*\(41,234 rows[^)]*\)", r"\s*\(7\) \[Time Entry Key\] is renumbered at every daily load\."],
}
# phase-1 entities keep their original property names; later entities prefix on any name collision
PHASE1 = ("Project", "Company", "Vendor", "Associate", "ProjectStage", "CalendarDay")
TYPE = {"varchar": "string", "nvarchar": "string", "char": "string", "int": "int64", "bigint": "int64", "smallint": "int64",
        "tinyint": "int64", "bit": "boolean", "decimal": "double", "numeric": "double", "float": "double", "real": "double",
        "date": "dateTime", "datetime": "dateTime", "datetime2": "dateTime"}

# entity name -> (schema, table, key column, display name, description, excluded columns)
ENTITIES = {
    "Project": ("analytics", "Dim_Project", "Project Number",
                "A construction project (Vista job) with its Procore project details. Hub of the Gold model: nearly every fact joins here.",
                ()),
    "Company": ("analytics", "Dim_Company", "Company Number",
                "An ARCO legal entity / Vista HQ company, with Family and type classification.",
                ("Federal Tax ID",)),
    "Vendor": ("analytics", "Dim_Vendor", "Vendor Number",
               "A vendor or subcontractor from Vista AP, cross-walked to Procore where matched.",
               ("Bank Account", "Routing Number", "Tax ID", "Tax ID Type", "Email 1099", "1099 Address Seq")),
    "Associate": ("analytics", "Dim_Associate_Public", "Email Address",
                  "An ARCO employee (HR-safe directory: work attributes only; personal names and contacts are not included) with crosswalk IDs to Concur, ARCO Hub, ServiceNow and the recruiting system.",
                  ()),
    "ProjectStage": ("analytics", "Dim_Department", "Department",
                     "A Vista job status / stage code and its description (Dim_Department translates Project Stage codes).",
                     ()),
    "CalendarDay": ("analytics", "Dim_Date", "date_key",
                    "A calendar day with week, month, quarter and year attributes.",
                    ("is_holiday", "holiday_text", "day_of_week_in_month")),
    # phase 2 (2026-10-05): Gold Financials dimensions. Fact tables wait for single-column keys (ETL ticket).
    "GLAccount": ("analytics", "Dim_GL_Account", "GL Account Number",
                  "A general ledger account in one Vista company (chart of accounts).", ()),
    "Customer": ("analytics", "Dim_Customer", "Customer Number",
                 "A Vista AR customer (project owner / billing party).", ()),
    "CostType": ("analytics", "Dim_Cost_Type", "Cost Type Number",
                 "A Vista job cost type (labor, material, burden...) within a phase group.", ()),
    # phase 3 (2026-10-05): dimensions from the other 10 models (single-column unique keys verified in SQL)
    "SubcontractorProject": ("analytics", "Dim_Textura_Project", "ID", "A subcontractor pay application project (Textura), cross-walked to the Vista job.", ()),
    "SubcontractorContract": ("analytics", "Dim_Textura_Contract", "ID", "A subcontractor contract (Textura): one owner-facing General Construction roll-up per project plus one per subcontract.", ()),
    "SubcontractorDraw": ("analytics", "Dim_Textura_Draw", "ID", "A subcontractor billing draw (pay period, Textura) for a project, usually monthly.", ()),
    "LeaveCode": ("ukg_analytics", "Dim_Leave_Code", "Leave Code Number", "A Vista leave (time off) plan code per payroll company.", ()),
    "EarnCode": ("payroll_analytics", "Dim_EarnCode", "Earn Code Key", "A Vista payroll earnings code per payroll company.", ()),
    "DeductionCode": ("payroll_analytics", "Dim_DeductionLiabilityCode", "DL Code Key", "A Vista payroll deduction or employer liability code per payroll company.", ()),
    "PayPeriod": ("payroll_analytics", "Dim_PayPeriod", "Pay Period Key", "A Vista payroll pay period (company + payroll group + period end date).", ()),
    "TaskType": ("servicenow_analytics", "Dim_Task_Type", "Task Type Key", "A ServiceNow task type and its work category.", ()),
    "ITServiceUser": ("servicenow_analytics", "Dim_SNOW_User", "SNOW Sys Id", "An IT service management (ServiceNow) user account.", ("Employee ID", "Azure Object Id")),
    "MCPLClient": ("analytics", "Dim_MCPL_Client", "MCPL Client ID", "A client on the Master Client Prospect List (ARCO Hub).", ()),
    "CRMAccount": ("analytics", "Dim_ADB_CRM_Account", "ADB CRM Account ID", "An ADB CRM account linked to client protection.", ()),
    "ProjectSubcontract": ("analytics", "Dim_ProjectVendor", "ProjectVendor Number", "A Vista subcontract (SL) on a project with its vendor.", ()),
    "ExpenseReport": ("concur_analytics", "Dim_Submitted_Expense_Report", "Expense Report Number", "A submitted Concur expense report.", ()),
    "ExpenseUser": ("concur_analytics", "Dim_Concur_User", "Employee Number", "An expense system (Concur) user account.",
                   ("Company Number", "Department", "Division", "Email Address", "Manager")),
    # phase 4 (2026-10-08): Greenhouse recruiting (live in prod gold; Gold Talent Acquisition model), Time Off requests, Job Cost
    # monthly financials. Keys verified unique + non-null in SQL 2026-10-08. PII excluded: candidate names / employer /
    # title / tags, user email + UKG ID, referrer names, location address, every EEOC field, requester comment, approver.
    "JobRequisition": ("greenhouse_analytics", "Dim_Job", "Job Number",
                       "A job requisition (recruiting job, from Greenhouse); not a Vista construction job (see Project).", ()),
    "RecruitingDepartment": ("greenhouse_analytics", "Dim_Department", "Department Number",
                             "A recruiting department (from Greenhouse); not the Vista job stage lookup.", ()),
    "Office": ("greenhouse_analytics", "Dim_Office", "Office Number", "A Greenhouse office (hiring location).", ()),
    "RecruitingUser": ("greenhouse_analytics", "Dim_User", "User Number", "A recruiting system (Greenhouse) user: recruiter, coordinator, hiring team.",
                       ("First Name", "Last Name", "Email Address", "Employee ID")),
    "Source": ("greenhouse_analytics", "Dim_Source", "Source Number", "A Greenhouse candidate source (job board, referral, agency...).", ()),
    "Referrer": ("greenhouse_analytics", "Dim_Referrer", "Referrer Number", "A person who referred a candidate in Greenhouse.",
                 ("Referrer Name",)),
    "RejectionReason": ("greenhouse_analytics", "Dim_Rejection_Reason", "Rejection Reason Number", "A Greenhouse application rejection reason.", ()),
    "CloseReason": ("greenhouse_analytics", "Dim_Close_Reason", "Close Reason Number", "A Greenhouse reason an opening was closed.", ()),
    "Candidate": ("greenhouse_analytics", "Dim_Candidate", "Candidate Number", "A Greenhouse candidate (no personal data).",
                  ("First Name", "Last Name", "Preferred Name", "Full Name", "Current Company", "Current Title", "Tags",
                   "Address", "Website")),
    "Application": ("greenhouse_analytics", "Fact_Application", "Application Number", "A candidate's application to a Greenhouse job.",
                    ("Location Address", "Has EEOC Response", "EEOC Submitted Date", "EEOC Gender", "EEOC Race",
                     "EEOC Veteran Status", "EEOC Disability Status")),
    "Offer": ("greenhouse_analytics", "Fact_Offer", "Offer Number", "A Greenhouse offer (version) made on an application.", ()),
    "Opening": ("greenhouse_analytics", "Fact_Opening", "Opening Number", "A seat (opening) on a Greenhouse job.", ()),
    "TimeOffRequest": ("ukg_analytics", "Fact_Associate_Time_Off_Request", "Time Off Request Number",
                       "One day of requested time off from Vista HR leave requests.", ("Requester Comment", "Approver")),
    "ProjectFinancialMonth": ("analytics", "Fact_Project_Financial", "Project Financial Number",
                              "Monthly Vista job financials for one company and job.", ()),
    # 2026-10-08 keyed entities: single-column surrogate keys live in prod gold (0 duplicate, 0 null; table = view).
    # Column sets mirror the published Gold Financials / Gold Legal models: AP invoice Notes removed as sensitive.
    "APInvoiceLine": ("analytics", "Fact_AP_Approved", "AP Line Key", "An approved (posted) Vista AP invoice line.", ("Notes",)),
    "UnapprovedAPLine": ("analytics", "Fact_AP_Unapproved", "AP Unapproved Line Key",
                         "A Vista AP invoice line still in the unapproved review queue (current snapshot).", ("Notes",)),
    "GLBudgetLine": ("analytics", "Fact_Company_Financial_Budget", "Budget Key",
                     "An annual Vista GL budget amount by company, GL account, fiscal year and budget code.", ()),
    "LegalMatter": ("counsellink_analytics", "Dim_Matter", "Matter Key", "A CounselLink legal matter or intake request.", ()),
    # 2026-10-08 orphan links: key [Matter Guid] verified unique + non-null in prod gold (4,245 rows). Column set mirrors the
    # published Gold Legal model; invoice-contact login / SSO IDs removed as personal identifiers.
    "ProjectContract": ("counsellink_analytics", "Dim_ProjectContract", "Matter Guid",
                        "The contract terms of a CounselLink prime contract matter.",
                        ("Invoice Contact Login Id", "Invoice Contact Sso Id")),
    # 2026-10-09 phase 6: keys verified unique + non-null in prod gold the same day; every key is the source system's own record
    # ID (no ROW_NUMBER keys). Column sets mirror the published Gold Textura / Safety / Job Cost / Expenses / Legal / MCPL models,
    # minus: login IDs and contact emails (personal identifiers), injury / incident / near-miss narratives (medical detail about
    # identifiable workers), manpower notes (can name workers, phones), expense purpose (attendee names, home addresses) and the
    # privileged claim narrative.
    "SubcontractorInvoice": ("analytics", "Fact_Textura_Invoice", "ID", "A subcontractor pay application (invoice) for one contract in one draw (Textura).", ()),
    "SubcontractorPayment": ("analytics", "Fact_Textura_Payment", "ID", "A payment to a subcontractor made through Textura.", ()),
    "SubcontractorBudgetLine": ("analytics", "Fact_Textura_Budget_Lines", "ID", "A schedule-of-values line of a subcontractor contract (Textura).", ()),
    "SubcontractorChangeOrder": ("analytics", "Fact_Textura_Change_Order", "ID", "A change order on a subcontractor contract (Textura).", ()),
    "LienWaiver": ("analytics", "Fact_Textura_Lien_Waiver", "ID", "Lien waiver compliance for a contract (or sub-tier supplier) in a draw (Textura).", ()),
    "SafetyIncident": ("analytics", "Fact_Incidents", "Procore Id", "A safety incident recorded in Procore.", ("Description", "Created By Login")),
    "SafetyInjury": ("analytics", "Fact_Incident_Injuries", "Procore Id", "An injury record on a safety incident (Procore).",
                     ("Description", "Description Plain Text", "Summary", "Incident Created By Login")),
    "NearMiss": ("analytics", "Fact_Incident_Near_Misses", "Procore Id", "A near-miss record on a safety incident (Procore).",
                 ("Description", "Description Plain Text", "Summary", "Incident Created By Login")),
    "ManpowerLog": ("analytics", "Fact_Manpower", "Manpower Log ID", "A daily-log manpower line: one company's crew and hours on a project for a day (Procore).",
                    ("Notes", "Contact Email")),
    "SafetyInspection": ("analytics", "Fact_Inspection", "id", "An inspection checklist on a project (Procore).",
                         ("Created By Login", "Closed By Login", "Point Of Contact Login")),
    "SafetyObservation": ("analytics", "Fact_Observations", "Observation ID", "An observation (safety hazard, quality deficiency, punch item) on a project (Procore).", ()),
    "Submittal": ("analytics", "Fact_Submittal", "Submittal ID", "A submittal revision (shop drawing, product data, sample) on a project (Procore).", ()),
    "PrimeContract": ("analytics", "Fact_PrimeContract", "Prime Contract ID", "A prime contract with the owner / client in Procore.", ()),
    "WorkOrderContract": ("analytics", "Fact_WorkOrderContract", "Work Order Contract ID", "A commitment (subcontract or purchase order) with a vendor in Procore.", ()),
    "InsuranceCompliance": ("mycoi_analytics", "Fact_Insurance_Compliance", "Assignment Id", "Insurance compliance of one active subcontract (myCOI).", ()),
    "ProjectCarryforward": ("analytics", "Dim_Project_Carryforward", "Project Number", "Year-end profit carryforward settings of a job (Vista).", ()),
    "ExpenseEntry": ("concur_analytics", "Fact_Submitted_Expense", "Expense Entry Number", "One line of a submitted expense report (Concur).", ("Expense Purpose",)),
    "LegalClaim": ("counsellink_analytics", "Dim_Matter_Claim", "Matter Guid", "Claim detail of a claims legal matter (CounselLink).", ("Claim Description",)),
    "ClientProtection": ("analytics", "Fact_Client_Protection", "Protection Record ID", "One ARCO company's protection (right to pursue) of a client or prospect (ARCO Hub).", ()),
    # 2026-10-09 IT time (Director: "add them"): the ServiceNow rebuild (prod gold 20:25 UTC) replaced the ROW_NUMBER keys with
    # stable SHA-256 hash keys; both keys verified unique + non-null the same day. Column sets mirror the published Gold IT Time
    # Tracking model minus the UKG Employee ID (confidential personal identifier, also excluded on ITServiceUser) and the
    # work-log Comments (names people, contains email addresses; the model says never use it in AI answers).
    "ITTicketTimeWorked": ("servicenow_analytics", "Fact_Task_Time_Worked", "Task Time Worked Sys Id",
                           "A work-log time entry on an IT support ticket (ServiceNow).", ("Employee ID", "Comments")),
    "ITTimeCardEntry": ("servicenow_analytics", "Fact_Time_Entry", "Time Entry Key",
                        "One day of a weekly IT time card line by task type (ServiceNow).", ("Employee ID",)),
}
# 2026-10-11 IT operations (user: "add them to a semantic model, and then the ontology"): the 22 servicenow_analytics tables
# added to the Gold IT Operations model the same day. Keys verified unique + non-null in prod gold 2026-10-11 (stable hash
# keys, except ITProjectSnapshot whose key is a row number). Exclusions mirror the model: every UKG Employee ID, survey
# comment text, company street / ZIP / phone / account-manager email, group email + always-zero hourly rate, empty columns;
# plus long free-text narratives (Description, Business Case / Justification, Mitigation, Assumptions), as for Safety / Legal.
NEW_IT = {
    "ITIncident": ("servicenow_analytics", "Fact_Incident", "Incident Sys Id", "An IT support incident (break / fix ticket, ServiceNow).", ('Assigned To Employee ID', 'Opened By Employee ID', 'Closed By Employee ID', 'Resolved By Employee ID', 'Caller Employee ID')),
    "ITServiceRequest": ("servicenow_analytics", "Fact_Service_Request_Item", "Service Request Item Sys Id", "A requested item (RITM): one line of an IT service catalog request (ServiceNow).", ('Requested For Employee ID', 'Assigned To Employee ID', 'Closed By Employee ID', 'Actual Duration Seconds')),
    "ITServiceTask": ("servicenow_analytics", "Fact_Service_Task", "Service Task Sys Id", "A catalog task (SCTASK): a work step IT support does to fulfil a requested item (ServiceNow).", ('Assigned To Employee ID', 'Closed By Employee ID')),
    "ServiceCatalogItem": ("servicenow_analytics", "Dim_Catalog_Item", "Catalog Item Key", "An IT service catalog item people can request (hardware, software, access, facilities).", ('Description', 'Owner Employee ID')),
    "ITSupportGroup": ("servicenow_analytics", "Dim_SNOW_Group", "SNOW Group Key", "An IT assignment group (support team or queue, ServiceNow).", ('Description', 'Cost Center Sys Id', 'Email', 'Manager Employee ID', 'Hourly Rate')),
    "ITServiceCompany": ("servicenow_analytics", "Dim_SNOW_Company", "SNOW Company Key", "A company record in IT service management: ARCO operating companies plus vendors and manufacturers.", ('Parent Company Sys Id', 'Street', 'ZIP Code', 'Phone', 'Account Manager Email')),
    "SupportSurveyResponse": ("servicenow_analytics", "Fact_CSAT_Response", "CSAT Response Key", "One answered (or sent) survey question: customer satisfaction and other IT assessments (ServiceNow).", ('String Value', 'Respondent Employee ID')),
    "SurveyType": ("servicenow_analytics", "Dim_Assessment_Metric", "Assessment Metric Key", "A survey or assessment type (e.g. ARCO Incident Survey, NPS).", ('Description',)),
    "SurveyQuestion": ("servicenow_analytics", "Dim_Assessment_Question", "Assessment Question Key", "A survey question with its answer type and scale.", ('Description',)),
    "ITProject": ("servicenow_analytics", "Dim_IT_Project", "IT Project Key", "An IT project in the IT project portfolio (ServiceNow), not a construction job.", ('Description', 'Assumptions', 'Project Manager Employee ID', 'Assigned To Employee ID')),
    "ITPortfolio": ("servicenow_analytics", "Dim_Portfolio", "Portfolio Key", "An IT project portfolio.", ('Description', 'Category', 'Business Unit', 'Department', 'Portfolio Manager Employee ID')),
    "ITProgram": ("servicenow_analytics", "Dim_Program", "Program Key", "An IT program grouping related IT projects.", ('Description', 'Business Unit', 'Department', 'Program Manager Employee ID')),
    "ITDemand": ("servicenow_analytics", "Fact_Demand", "Demand Key", "An IT demand: an idea or request for new IT work before it becomes a project or enhancement.", ('Description', 'Business Case', 'Business Unit', 'Demand Manager Employee ID', 'Submitter Employee ID', 'Project Manager Employee ID', 'Assigned To Employee ID')),
    "ITDemandTask": ("servicenow_analytics", "Fact_Demand_Task", "Demand Task Key", "A task raised on an IT demand (mostly initial reviews).", ('Description', 'Assigned To Employee ID', 'Start Date', 'End Date')),
    "ITEnhancement": ("servicenow_analytics", "Dim_Enhancement", "Enhancement Key", "An IT enhancement: a small change to an existing application.", ('Description', 'Assigned To Employee ID', 'Closed By Employee ID')),
    "ITProjectTask": ("servicenow_analytics", "Fact_Project_Task", "Project Task Sys Id", "A task in an IT project's work breakdown (phases, milestones, Ops bucket tasks).", ('Assigned To Employee ID', 'Opened By Employee ID', 'Closed By Employee ID')),
    "ITProjectSnapshot": ("servicenow_analytics", "Fact_IT_Project_Snapshot", "IT Project Snapshot Key", "A weekly status snapshot of one open IT project.", ('Project Manager Employee ID',)),
    "ITProjectRisk": ("servicenow_analytics", "Fact_Risk", "Risk Key", "A risk logged on an IT project.", ('Description', 'Mitigation', 'Risk Owner Employee ID', 'Assigned To Employee ID')),
    "ITProjectIssue": ("servicenow_analytics", "Fact_Issue", "Issue Key", "An issue logged on an IT project.", ('Description', 'Assigned To Employee ID', 'Assigned To SNOW Sys Id')),
    "ITProjectChange": ("servicenow_analytics", "Fact_Change_Request", "Change Request Key", "A change request (scope, schedule, cost, resource) on an IT project.", ('Description', 'Business Justification', 'Assigned To Employee ID')),
    "ITDecision": ("servicenow_analytics", "Fact_Decision", "Decision Key", "A decision recorded on an IT project or demand.", ('Description', 'Assigned To Employee ID')),
    "ITProjectCostPlan": ("servicenow_analytics", "Fact_Project_Cost_Plan_Breakdown", "Cost Plan Breakdown Key", "One line of an IT cost plan at portfolio, program, requirement or task level.", ()),
}
ENTITIES.update(NEW_IT)
DESC_MODEL.update({e: "Gold IT Operations" for e in NEW_IT})
PREFIX.update({"ITIncident": "Inc", "ITServiceRequest": "ReqItem", "ITServiceTask": "CatTask", "ServiceCatalogItem": "CatItem",
               "ITSupportGroup": "SupportGroup", "ITServiceCompany": "SvcCompany", "SupportSurveyResponse": "Survey",
               "SurveyType": "SurveyType", "SurveyQuestion": "SurveyQ", "ITProject": "ITProject", "ITPortfolio": "ITPortfolio",
               "ITProgram": "ITProgram", "ITDemand": "Demand", "ITDemandTask": "DemandTask", "ITEnhancement": "Enh",
               "ITProjectTask": "ITTask", "ITProjectSnapshot": "Snap", "ITProjectRisk": "Risk", "ITProjectIssue": "Issue",
               "ITProjectChange": "ITChange", "ITDecision": "Decision", "ITProjectCostPlan": "CostPlan"})
# every property of these entities carries the entity prefix (State, Priority, Short Description... exist on most of them)
FORCE_PREFIX = set(NEW_IT)
PROP_NAME.update({("ITIncident", "Incident Number"): "ITIncidentNumber", ("ITProject", "Project Number"): "ITProjNumber",
                  ("SurveyType", "Assessment Metric Key"): "SurveyTypeKey", ("SurveyType", "Assessment Metric Sys Id"): "SurveyTypeSysId",
                  ("ITDemand", "Converted To IT Project Key"): "DemandITProjectKey",
                  ("ITDemand", "Converted To IT Project Sys Id"): "DemandITProjectSysId",
                  ("ITDemand", "Converted To Enhancement Key"): "DemandEnhancementKey",
                  ("ITDemand", "Converted To Enhancement Sys Id"): "DemandEnhancementSysId",
                  ("ITDemand", "Converted To Enhancement Number"): "DemandEnhancementNumber",
                  ("ITDecision", "State"): "DecisionParentState"})
COL_NOTE[("ITTimeCardEntry", "Top Project Key")] = ("Hash key of the ServiceNow IT project above the task (bigint, stable; set on 24,762 rows, "
    "100% resolve to ITProject on 2026-10-11): the 'Time Card Hours On IT Project' link. Not a Vista construction project.")
COL_NOTE.update({
    ("SupportSurveyResponse", "Rating Score"): "Mixed scales: 1 to 5 only on the three customer satisfaction surveys (SurveyType ARCO Incident Survey, ARCO Customer Satisfaction Survey, Short Customer Satisfaction Survey using Smiley Face) with a Rating question scaled 1 to 5; NPS is 0 to 10 and internal assessments up to 100. Never average across survey types.",
    ("SupportSurveyResponse", "Assessment Instance Sys Id"): "The survey: each survey has two rows (rating + comment question); count surveys as distinct values of this property, never rows.",
    ("ITIncident", "Short Description"): "Sensitive: free text that can name people; do not quote it in answers about individuals.",
    ("ITServiceRequest", "Short Description"): "Sensitive: free text that can name people; do not quote it in answers about individuals.",
    ("ITServiceTask", "Short Description"): "Sensitive: free text that can name people; do not quote it in answers about individuals.",
    ("ITProjectCostPlan", "Is Leaf Level"): "Sum budget and actual only where this is true (task level): higher levels repeat the same amounts.",
})

# TOM relationship name -> (from entity, from col, to entity, to col, entity relationship name, description)
RELS = [
    ("rel_project_company", "Project", "Controlling Company", "Company", "Company Number", "Project Controlled By Company",
     "The Vista company that controls (books) the project."),
    ("rel_project_stage", "Project", "Stage", "ProjectStage", "Department", "Project In Stage",
     "The project's current Vista job status / stage. About a third of projects have a stage code with no description row."),
    ("rel_associate_company", "Associate", "GL Company Code", "Company", "Company Number", "Associate Employed By Company",
     "The GL (posting) company of the associate. Not the payroll company: payroll joins use UKG Company Code."),
    ("rel_vendor_company", "Vendor", "GL Company", "Company", "Company Number", "Vendor Registered To Company",
     "The Vista company whose AP vendor master holds this vendor record."),
    ("rel_glaccount_company", "GLAccount", "Company Number", "Company", "Company Number", "GL Account Belongs To Company",
     "Each GL account belongs to one Vista company's chart of accounts; the same account code exists in many companies."),
    ("rel_texproject_project", "SubcontractorProject", "Project Number", "Project", "Project Number", "Subcontractor Project For Project", "Subcontractor (Textura) project cross-walked to the Vista job (99.6%)."),
    ("rel_texcontract_texproject", "SubcontractorContract", "Project ID", "SubcontractorProject", "ID", "Contract On Subcontractor Project", "Each subcontractor contract belongs to one subcontractor project (Textura)."),
    ("rel_texdraw_texproject", "SubcontractorDraw", "Project ID", "SubcontractorProject", "ID", "Draw On Subcontractor Project", "Each draw (pay period) belongs to one subcontractor project (Textura)."),
    ("rel_leavecode_company", "LeaveCode", "Payroll Company", "Company", "Company Number", "Leave Plan Of Company", "Leave plans are defined per payroll company."),
    ("rel_earncode_company", "EarnCode", "Payroll Company", "Company", "Company Number", "Earn Code Of Company", "Earn codes are defined per payroll company."),
    ("rel_dlcode_company", "DeductionCode", "Payroll Company", "Company", "Company Number", "Deduction Code Of Company", "Deduction and liability codes are defined per payroll company."),
    ("rel_payperiod_company", "PayPeriod", "Payroll Company", "Company", "Company Number", "Pay Period Of Company", "Pay periods are defined per payroll company and payroll group."),
    ("rel_associate_snowuser", "Associate", "ServiceNow Sys Id", "ITServiceUser", "SNOW Sys Id", "Associate Has IT Service Account", "The associate's IT service management (ServiceNow) user (98.8% of time entries resolve)."),
    ("rel_subcontract_project", "ProjectSubcontract", "Project Number", "Project", "Project Number", "Subcontract On Project", "The Vista job the subcontract is written against (77.8% of subcontracts match Dim_Project)."),
    ("rel_subcontract_vendor", "ProjectSubcontract", "Vendor Number", "Vendor", "Vendor Number", "Subcontract With Vendor", "The Vista vendor holding the subcontract."),
    ("rel_expensereport_associate", "ExpenseReport", "Employee Number", "Associate", "Concur Employee ID", "Expense Report Submitted By Associate", "Concur employee ID of the submitter (98.8% resolve). Not the UKG employee number."),
    ("rel_expensereport_company", "ExpenseReport", "GL Company", "Company", "Company Number", "Expense Report Charged To Company", "The GL company the report posts to."),
    ("rel_concuruser_associate", "ExpenseUser", "Employee Number", "Associate", "Concur Employee ID", "Expense Account Of Associate", "Expense system (Concur) user account of the associate (89.9% resolve)."),
    ("rel_crmaccount_owner", "CRMAccount", "Owner Associate ID", "Associate", "ARCO Hub User ID", "CRM Account Owned By Associate", "ARCO Hub user who owns the CRM account; blank owners must not be matched to associates with blank Hub IDs."),
    ("rel_crmaccount_client", "CRMAccount", "MCPL Client ID", "MCPLClient", "MCPL Client ID", "CRM Account For Client", "MCPL client the CRM account maps to (21% filled)."),
    # phase 4 (2026-10-08): match rates from SQL on 2026-10-08 (share of non-blank keys that resolve)
    ("rel_app_candidate", "Application", "Candidate Number", "Candidate", "Candidate Number", "Application By Candidate",
     "The candidate who applied (100% of 63,320 applications)."),
    ("rel_app_job", "Application", "Job Number", "JobRequisition", "Job Number", "Application To Job",
     "The job applied to (100% of 41,098 applications with a job; 22,222 prospect applications have no job)."),
    ("rel_app_source", "Application", "Source Number", "Source", "Source Number", "Application From Source",
     "Where the candidate came from (100% of non-blank; 275 applications have no source)."),
    ("rel_app_referrer", "Application", "Referrer Number", "Referrer", "Referrer Number", "Application Referred By",
     "Who referred the candidate (3,048 referred applications, 100% resolve)."),
    ("rel_app_rejreason", "Application", "Rejection Reason Number", "RejectionReason", "Rejection Reason Number", "Application Rejected For",
     "Why a rejected application was rejected (27,143 applications, 100% resolve)."),
    ("rel_app_recruiter", "Application", "Recruiter User Number", "RecruitingUser", "User Number", "Application Recruiter",
     "The recruiter on the application (36,866 applications, 100% resolve; blank on the rest)."),
    ("rel_offer_app", "Offer", "Application Number", "Application", "Application Number", "Offer On Application",
     "The application the offer was made on (100% of 462 offers)."),
    ("rel_offer_job", "Offer", "Job Number", "JobRequisition", "Job Number", "Offer For Job",
     "The job the offer is for (459 of 462 offers; 3 have no job)."),
    ("rel_opening_job", "Opening", "Job Number", "JobRequisition", "Job Number", "Opening On Job",
     "The job the opening (seat) belongs to (100% of 1,438 openings); a job can have up to 40 openings."),
    ("rel_opening_closereason", "Opening", "Close Reason Number", "CloseReason", "Close Reason Number", "Opening Closed For",
     "Why the opening was closed (218 closed openings, 100% resolve)."),
    ("rel_ghjob_ghdept", "JobRequisition", "Department Number", "RecruitingDepartment", "Department Number", "Requisition In Recruiting Department",
     "The recruiting (Greenhouse) department of the job requisition (100% of 675 jobs)."),
    ("rel_ghjob_company", "JobRequisition", "Company Number", "Company", "Company Number", "Job Hiring For Company",
     "The Vista (GL) company the job hires for, from the UKG organization field or the job's office (665 of 675 jobs; 10 blank)."),
    ("rel_office_company", "Office", "Company Number", "Company", "Company Number", "Office Of Company",
     "The Vista company of the office (109 of 115 offices; 6 blank)."),
    ("rel_associate_ghuser", "Associate", "Greenhouse User Number", "RecruitingUser", "User Number", "Associate Has Recruiting Login",
     "The associate's recruiting system (Greenhouse) login (2,752 associates, 100% of non-blank resolve)."),
    ("rel_timeoff_leavecode", "TimeOffRequest", "Leave Code Number", "LeaveCode", "Leave Code Number", "Time Off Charged To Leave Plan",
     "The leave plan (payroll company + code) the requested day is charged to (100% of 85,991 rows)."),
    ("rel_pfm_project", "ProjectFinancialMonth", "Project Number", "Project", "Project Number", "Financials For Project",
     "The Vista job (partial: 62.9% of rows, 15,582 of 29,356 jobs, match Project; overhead, service and old jobs do not)."),
    ("rel_pfm_company", "ProjectFinancialMonth", "Company Number", "Company", "Company Number", "Financials Booked By Company",
     "The Vista company whose books hold the row (100%); joint-venture jobs have one row per participating company."),
    # 2026-10-08 keyed entities: match rates from SQL on prod gold 2026-10-08 (share of non-blank keys that resolve)
    ("rel_apline_vendor", "APInvoiceLine", "Vendor Number", "Vendor", "Vendor Number", "AP Line Paid To Vendor",
     "The Vista vendor ('<vendor>-<vendor group>') on the invoice (100% of 3,857,647 lines)."),
    ("rel_apline_company", "APInvoiceLine", "AP Company", "Company", "Company Number", "AP Line Owed By Company",
     "The Vista AP company that owes the invoice (100%). The job's company (JC Company) differs on about a fifth of lines."),
    ("rel_apline_project", "APInvoiceLine", "Project Number", "Project", "Project Number", "AP Line Charged To Project",
     "The Vista job the line is charged to (partial: 71.7% of the 3,303,247 lines with a job match Project; the rest are "
     "overhead/G&A jobs such as 9210 and 7940 and jobs not in the project list; 554,400 lines have no job)."),
    ("rel_apu_vendor", "UnapprovedAPLine", "Vendor Number", "Vendor", "Vendor Number", "Unapproved Line From Vendor",
     "The Vista vendor ('<vendor>-<vendor group>') on the invoice (99.8%: 9,126 of 9,144 lines)."),
    ("rel_apu_company", "UnapprovedAPLine", "AP Company", "Company", "Company Number", "Unapproved Line Owed By Company",
     "The Vista AP company that will owe the invoice (100% of 9,144 lines)."),
    ("rel_apu_project", "UnapprovedAPLine", "Project Number", "Project", "Project Number", "Unapproved Line For Project",
     "The Vista job the line is coded to (partial: 82.5%, 6,918 of 8,383 lines with a job; the rest are overhead/G&A jobs "
     "and new jobs not yet in the project list; 761 lines have no job)."),
    ("rel_budget_company", "GLBudgetLine", "Company Number", "Company", "Company Number", "Budget Line For Company",
     "The Vista company whose budget it is (100% of 44,181 rows)."),
    ("rel_budget_glaccount", "GLBudgetLine", "GL Account Number", "GLAccount", "GL Account Number", "Budget Line For GL Account",
     "The GL account ('<company>-<account>') budgeted (100% of 44,181 rows)."),
    # 2026-10-08 orphan links: match rates from SQL on prod gold 2026-10-08
    ("rel_projcontract_project", "ProjectContract", "Viewpoint Job Number", "Project", "Project Number", "Contract For Project",
     "The Vista job the contract is for (94.6%: 3,828 of the 4,048 contracts with a job number match Project exactly; 197 have no "
     "job number; misses are placeholders such as TBD or N/A and jobs not in the project list). A project can have several "
     "contract matters (e.g. C505 has 3)."),
    ("rel_matter_projcontract", "LegalMatter", "Matter Guid", "ProjectContract", "Matter Guid", "Matter Has Contract Terms",
     "The contract terms of a contract matter: 4,245 of the 7,338 matters have one (every project contract resolves to its "
     "matter); the rest are non-contract matters such as claims, NDAs and subcontract reviews. An intake shares its matter's GUID, "
     "so an intake whose matter has contract terms links to the same contract (none of the 49 intakes do today)."),
    # 2026-10-09 phase 6: match rates from SQL on prod gold 2026-10-09; same data type on both ends verified
    ("rel_injury_incident", "SafetyInjury", "Incident Id", "SafetyIncident", "Procore Id", "Injury On Incident",
     "The safety incident the injury record belongs to (100% of 1,347 injury records)."),
    ("rel_nearmiss_incident", "NearMiss", "Incident Id", "SafetyIncident", "Procore Id", "Near Miss On Incident",
     "The safety incident the near-miss record belongs to (100% of 510 near-miss records)."),
    ("rel_subbudget_subcontract", "SubcontractorBudgetLine", "Contract ID", "SubcontractorContract", "ID", "Budget Line On Subcontractor Contract",
     "The subcontractor contract the schedule-of-values line belongs to (93.8%: 132,021 of 140,698 lines; the other 8,677 lines sit on "
     "contracts missing from the subcontractor contract list and drop out of contract or project questions)."),
    ("rel_prime_project", "PrimeContract", "Project Number", "Project", "Project Number", "Prime Contract For Project",
     "The Vista job of the prime contract (100% of the 5,737 contracts with a job number; 671 have no job number)."),
    ("rel_workorder_project", "WorkOrderContract", "Project Number", "Project", "Project Number", "Commitment On Project",
     "The Vista job of the commitment (100% of the 71,448 commitments with a job number; 2,156 have none)."),
    ("rel_insurance_project", "InsuranceCompliance", "Project Number", "Project", "Project Number", "Insurance Compliance For Project",
     "The Vista job of the insured subcontract (99.3%: 5,175 of 5,211 assignments)."),
    ("rel_carryforward_project", "ProjectCarryforward", "Project Number", "Project", "Project Number", "Carryforward For Project",
     "The job whose carryforward settings these are (100% of 1,093 jobs; one row per job)."),
    ("rel_carryforward_company", "ProjectCarryforward", "Company Number", "Company", "Company Number", "Carryforward Booked By Company",
     "The Vista company that recorded the carryforward (100%; equals the job's controlling company)."),
    ("rel_expenseentry_report", "ExpenseEntry", "Expense Report Number", "ExpenseReport", "Expense Report Number", "Expense Line On Report",
     "The submitted expense report the line belongs to (100% of 1,644,875 lines)."),
    ("rel_expenseentry_project", "ExpenseEntry", "Project Number", "Project", "Project Number", "Expense Line Charged To Project",
     "The Vista job the line is charged to (partial: 74.4%, 1,117,083 of the 1,501,850 lines with a job; overhead jobs such as 9210, "
     "9120, 25102 and 26102 are not in the project list; 143,025 lines have no job)."),
    ("rel_expenseentry_company", "ExpenseEntry", "JC Company Number", "Company", "Company Number", "Expense Line Charged To Company",
     "The Vista job cost company the line is charged to (100% of the 1,644,864 lines with a company)."),
    ("rel_matter_claim", "LegalMatter", "Matter Guid", "LegalClaim", "Matter Guid", "Matter Has Claim Details",
     "The claim detail of a claims matter (all 1,306 claim records resolve to their matter; most other matters have none)."),
    ("rel_protection_client", "ClientProtection", "MCPL Client ID", "MCPLClient", "MCPL Client ID", "Protection Of Client",
     "The client or prospect being protected (100% of 5,826 protections); a client can hold several protections."),
    ("rel_protection_company", "ClientProtection", "Company Number", "Company", "Company Number", "Protection Held By Company",
     "The ARCO company holding the protection (100% of 5,826)."),
    ("rel_timeoff_day", "TimeOffRequest", "Request Date Key", "CalendarDay", "date_key", "Time Off Requested For Day",
     "The calendar day the time off is requested for (yyyymmdd; 100% of rows)."),
    # 2026-10-09 IT time: match rates from SQL on prod gold 2026-10-09; identical data types on both ends verified
    # (Task Type Key int = int, Date Key int = date_key int, SNOW Sys Id varchar = varchar). The user link uses the ITServiceUser
    # KEY (SNOW Sys Id); the facts' bigint SNOW User Key also matches ITServiceUserKey 100% but is not the entity key.
    # Time card IT project (Top Project Key) has no target: IT projects (Dim_IT_Project) are not an ontology entity.
    ("rel_tickettime_tasktype", "ITTicketTimeWorked", "Task Type Key", "TaskType", "Task Type Key", "Ticket Time Of Task Type",
     "The ticket type of the work-log entry: Incident, Request (catalog tasks and requested items) or Unknown (100% of 436,567 entries)."),
    ("rel_tickettime_day", "ITTicketTimeWorked", "Date Key", "CalendarDay", "date_key", "Ticket Time Logged On Day",
     "The calendar day the work-log entry was recorded (yyyymmdd; 100% of entries)."),
    ("rel_tickettime_user", "ITTicketTimeWorked", "SNOW Sys Id", "ITServiceUser", "SNOW Sys Id", "Ticket Time Logged By IT User",
     "The IT service user who logged the time (100% of the 436,559 entries with a user; 8 entries have none). Reach the associate "
     "through the user's 'Associate Has IT Service Account' link."),
    ("rel_timecard_tasktype", "ITTimeCardEntry", "Task Type Key", "TaskType", "Task Type Key", "Time Card Hours Of Task Type",
     "The task type of the time card hours (project task, incident, request, Ops bucket, admin, meeting, time off...; 100% of 42,120 rows). "
     "Group work with the task type's Work Category."),
    ("rel_timecard_day", "ITTimeCardEntry", "Date Key", "CalendarDay", "date_key", "Time Card Hours On Day",
     "The work date of the time card hours (yyyymmdd; 100% of rows; dates after today are planned time off)."),
    ("rel_timecard_user", "ITTimeCardEntry", "SNOW Sys Id", "ITServiceUser", "SNOW Sys Id", "Time Card Of IT User",
     "The IT service user whose time card it is (100% of the 42,119 rows with a user; 1 row has none). Reach the associate through the "
     "user's 'Associate Has IT Service Account' link."),
]


# 2026-10-11 IT operations links (match rates from SQL on prod gold 2026-10-11; types identical on both ends)
RELS += [
    ('rel_tickettime_incident', 'ITTicketTimeWorked', 'Task Sys Id', 'ITIncident', 'Incident Sys Id', 'Ticket Time On Incident', 'The incident the work-log time was logged on (215,129 of 436,745 entries; the others are on requested items or catalog tasks; together 99.995% resolve).'),
    ('rel_tickettime_request', 'ITTicketTimeWorked', 'Task Sys Id', 'ITServiceRequest', 'Service Request Item Sys Id', 'Ticket Time On Requested Item', 'The requested item the work-log time was logged on (95,636 entries).'),
    ('rel_tickettime_cattask', 'ITTicketTimeWorked', 'Task Sys Id', 'ITServiceTask', 'Service Task Sys Id', 'Ticket Time On Catalog Task', 'The catalog task the work-log time was logged on (125,959 entries).'),
    ('rel_timecard_itproject', 'ITTimeCardEntry', 'Top Project Key', 'ITProject', 'IT Project Key', 'Time Card Hours On IT Project', "The IT project above the time card task (100% of the 24,762 rows with a project). Six 'ABS <Team> Operations' projects are IT support buckets, not project work."),
    ('rel_timecard_projtask', 'ITTimeCardEntry', 'Task Sys Id', 'ITProjectTask', 'Project Task Sys Id', 'Time Card Hours On Project Task', 'The IT project task the hours were logged to (24,655 of the 28,427 rows with a task; the rest are tickets or other task types).'),
    ('rel_incident_group', 'ITIncident', 'Assignment Group Key', 'ITSupportGroup', 'SNOW Group Key', 'Incident Assigned To Group', 'The support group (queue) the incident is assigned to (100% of the 87,725 with a group).'),
    ('rel_incident_assignee', 'ITIncident', 'Assigned To SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Incident Assigned To IT User', 'The IT support person assigned to the incident (100% of 84,595 assigned).'),
    ('rel_incident_caller', 'ITIncident', 'Caller SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Incident Reported By User', 'The person who reported the incident (99.98% of 87,751 with a caller).'),
    ('rel_incident_company', 'ITIncident', 'SNOW Company Key', 'ITServiceCompany', 'SNOW Company Key', 'Incident For Company', "The caller's company record (100% of the 68,840 incidents with one)."),
    ('rel_request_catalog', 'ITServiceRequest', 'Catalog Item Key', 'ServiceCatalogItem', 'Catalog Item Key', 'Requested Item Of Catalog Item', 'The catalog item that was requested (100% of 38,443 with one).'),
    ('rel_request_group', 'ITServiceRequest', 'Assignment Group Key', 'ITSupportGroup', 'SNOW Group Key', 'Requested Item Assigned To Group', 'The support group fulfilling the requested item (100% of 38,503).'),
    ('rel_request_assignee', 'ITServiceRequest', 'Assigned To SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Requested Item Assigned To IT User', 'The IT support person assigned to the requested item (100% of 37,072).'),
    ('rel_request_for', 'ITServiceRequest', 'Requested For SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Item Requested For User', 'The person the item was requested for (97.7% of 38,420).'),
    ('rel_request_company', 'ITServiceRequest', 'SNOW Company Key', 'ITServiceCompany', 'SNOW Company Key', 'Requested Item For Company', "The requester's company record (100% of 30,314)."),
    ('rel_request_itproject', 'ITServiceRequest', 'IT Project Key', 'ITProject', 'IT Project Key', 'Requested Item For IT Project', 'The IT project the request belongs to (only 87 requested items carry one).'),
    ('rel_cattask_request', 'ITServiceTask', 'Service Request Item Sys Id', 'ITServiceRequest', 'Service Request Item Sys Id', 'Catalog Task Fulfils Requested Item', 'The requested item the catalog task fulfils (100% of 101,883 with one); an item usually has several tasks.'),
    ('rel_cattask_catalog', 'ITServiceTask', 'Catalog Item Key', 'ServiceCatalogItem', 'Catalog Item Key', 'Catalog Task Of Catalog Item', 'The catalog item behind the task (100% of 90,250 with one).'),
    ('rel_cattask_group', 'ITServiceTask', 'Assignment Group Key', 'ITSupportGroup', 'SNOW Group Key', 'Catalog Task Assigned To Group', 'The support group working the task (100% of 101,937).'),
    ('rel_cattask_assignee', 'ITServiceTask', 'Assigned To SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Catalog Task Assigned To IT User', 'The IT support person assigned to the task (100% of 95,818).'),
    ('rel_cattask_company', 'ITServiceTask', 'SNOW Company Key', 'ITServiceCompany', 'SNOW Company Key', 'Catalog Task For Company', "The requester's company record (100% of 41,784)."),
    ('rel_svccompany_company', 'ITServiceCompany', 'Company Number', 'Company', 'Company Number', 'IT Company Record Of Company', 'The ARCO company (HQCO) behind an IT service company record (171 of 171 with a number; vendors and manufacturers have none).'),
    ('rel_survey_incident', 'SupportSurveyResponse', 'Trigger Sys Id', 'ITIncident', 'Incident Sys Id', 'Survey About Incident', 'The incident that triggered the survey (214,664 survey rows); its assignee is the technician being rated.'),
    ('rel_survey_request', 'SupportSurveyResponse', 'Trigger Sys Id', 'ITServiceRequest', 'Service Request Item Sys Id', 'Survey About Requested Item', 'The requested item that triggered the survey (73,888 survey rows).'),
    ('rel_survey_respondent', 'SupportSurveyResponse', 'Respondent SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Survey Answered By User', 'The person who received and answered the survey (100% of 290,165 with one).'),
    ('rel_survey_type', 'SupportSurveyResponse', 'Assessment Metric Key', 'SurveyType', 'Assessment Metric Key', 'Survey Of Type', 'The survey type (100%); only three types are 1 to 5 customer satisfaction surveys.'),
    ('rel_survey_question', 'SupportSurveyResponse', 'Assessment Question Key', 'SurveyQuestion', 'Assessment Question Key', 'Answer To Question', 'The question answered, with its scale (100%).'),
    ('rel_survey_tasktype', 'SupportSurveyResponse', 'Trigger Task Type Key', 'TaskType', 'Task Type Key', 'Survey Triggered By Task Type', 'The kind of record that triggered the survey (100%).'),
    ('rel_question_type', 'SurveyQuestion', 'Assessment Metric Key', 'SurveyType', 'Assessment Metric Key', 'Question Belongs To Survey Type', 'The survey type the question belongs to (150 of 150 with one).'),
    ('rel_itproject_pm', 'ITProject', 'Project Manager SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'IT Project Managed By', 'The IT project manager (100% of 287 with one).'),
    ('rel_projtask_project', 'ITProjectTask', 'IT Project Key', 'ITProject', 'IT Project Key', 'Task In IT Project', 'The IT project the task belongs to (100% of 5,003 with one).'),
    ('rel_projtask_assignee', 'ITProjectTask', 'Assigned To SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Project Task Assigned To IT User', 'The person assigned to the project task (100% of 1,793 assigned).'),
    ('rel_projtask_group', 'ITProjectTask', 'Assignment Group Key', 'ITSupportGroup', 'SNOW Group Key', 'Project Task Assigned To Group', 'The group assigned to the project task (100% of 900 with one).'),
    ('rel_snapshot_project', 'ITProjectSnapshot', 'IT Project Key', 'ITProject', 'IT Project Key', 'Snapshot Of IT Project', 'The IT project the weekly snapshot describes (100% of 487).'),
    ('rel_snapshot_portfolio', 'ITProjectSnapshot', 'Portfolio Key', 'ITPortfolio', 'Portfolio Key', 'Snapshot In Portfolio', 'The portfolio at snapshot time (100% of 379 with one).'),
    ('rel_risk_project', 'ITProjectRisk', 'IT Project Key', 'ITProject', 'IT Project Key', 'Risk On IT Project', 'The IT project the risk is logged on (100% of 34).'),
    ('rel_issue_project', 'ITProjectIssue', 'IT Project Key', 'ITProject', 'IT Project Key', 'Issue On IT Project', 'The IT project the issue is logged on (100% of 17).'),
    ('rel_change_project', 'ITProjectChange', 'IT Project Key', 'ITProject', 'IT Project Key', 'Change Request On IT Project', 'The IT project the change request is on (100% of 39).'),
    ('rel_decision_project', 'ITDecision', 'IT Project Key', 'ITProject', 'IT Project Key', 'Decision On IT Project', 'The IT project the decision is on (100% of 13 with one).'),
    ('rel_decision_demand', 'ITDecision', 'Demand Key', 'ITDemand', 'Demand Key', 'Decision On Demand', 'The demand the decision is on (100% of 12 with one).'),
    ('rel_costplan_project', 'ITProjectCostPlan', 'IT Project Key', 'ITProject', 'IT Project Key', 'Cost Plan Line For IT Project', 'The IT project of a cost plan line (100% of 114 with one).'),
    ('rel_costplan_program', 'ITProjectCostPlan', 'Program Key', 'ITProgram', 'Program Key', 'Cost Plan Line For Program', 'The IT program of a cost plan line (100% of 391 with one).'),
    ('rel_costplan_portfolio', 'ITProjectCostPlan', 'Portfolio Key', 'ITPortfolio', 'Portfolio Key', 'Cost Plan Line For Portfolio', 'The portfolio of a cost plan line (100% of 487 with one).'),
    ('rel_costplan_demand', 'ITProjectCostPlan', 'Demand Key', 'ITDemand', 'Demand Key', 'Cost Plan Line For Demand', 'The demand of a cost plan line (100% of 192 with one).'),
    ('rel_demand_portfolio', 'ITDemand', 'Portfolio Key', 'ITPortfolio', 'Portfolio Key', 'Demand In Portfolio', 'The portfolio of the demand (100% of 341 with one).'),
    ('rel_demand_program', 'ITDemand', 'Program Key', 'ITProgram', 'Program Key', 'Demand In Program', 'The program of the demand (100% of 324 with one).'),
    ('rel_demand_project', 'ITDemand', 'Converted To IT Project Key', 'ITProject', 'IT Project Key', 'Demand Became IT Project', 'The IT project the demand was converted into (100% of 76 converted).'),
    ('rel_demand_enhancement', 'ITDemand', 'Converted To Enhancement Key', 'ITEnhancement', 'Enhancement Key', 'Demand Became Enhancement', 'The enhancement the demand was converted into (100% of 101 converted).'),
    ('rel_demand_assignee', 'ITDemand', 'Assigned To SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Demand Assigned To IT User', 'The person the demand is assigned to (100% of 368 assigned).'),
    ('rel_demandtask_demand', 'ITDemandTask', 'Demand Key', 'ITDemand', 'Demand Key', 'Task On Demand', 'The demand the task was raised on (100% of 100).'),
    ('rel_enhancement_group', 'ITEnhancement', 'Assignment Group Key', 'ITSupportGroup', 'SNOW Group Key', 'Enhancement Assigned To Group', 'The group delivering the enhancement (100% of 138 with one).'),
    ('rel_enhancement_assignee', 'ITEnhancement', 'Assigned To SNOW Sys Id', 'ITServiceUser', 'SNOW Sys Id', 'Enhancement Assigned To IT User', 'The person assigned to the enhancement (100% of 136 assigned).'),
]


# 2026-10-11 (CIO agent review, user: "push the changes you can to incident and inspections"): Procore project id links.
# Target is Project ProcoreID (unique where filled, int; not the Project key: same non-key-target pattern as the live
# ExpenseReport -> Associate Concur Employee ID link). Stopgap until gold carries a Vista project number on Procore facts.
RELS += [
    ("rel_incident_project", "SafetyIncident", "Project Id", "Project", "Procore ID", "Incident On Project",
     "The project the safety incident happened on, matched on the Procore project id (97.3%: 4,445 of 4,568 incidents on 2026-10-11; the rest are on Procore projects with no Vista job)."),
    ("rel_inspection_project", "SafetyInspection", "Project Id", "Project", "Procore ID", "Inspection On Project",
     "The project of the safety inspection, matched on the Procore project id (95.9%: 132,571 of 138,257 inspections on 2026-10-11)."),
]


# entities added from 2026-10-09 (phase 6) on: case-insensitive collision check + readable abbreviations for long names.
# Earlier entities keep their live names (lineage tags match on names).
READABLE = ("SubcontractorInvoice", "SubcontractorPayment", "SubcontractorBudgetLine", "SubcontractorChangeOrder", "LienWaiver",
            "SafetyIncident", "SafetyInjury", "NearMiss", "ManpowerLog", "SafetyInspection", "SafetyObservation", "Submittal",
            "PrimeContract", "WorkOrderContract", "InsuranceCompliance", "ProjectCarryforward", "ExpenseEntry", "LegalClaim",
            "ClientProtection", "ITTicketTimeWorked", "ITTimeCardEntry")
READABLE = READABLE + tuple(NEW_IT)
ABBREV = [("Amount", "Amt"), ("Specification", "Spec"), ("Description", "Desc"),
          ("Unconditional", "Uncond"), ("Conditional", "Cond"), ("Percent", "Pct"), ("Retention", "Ret"),
          ("Responsible", "Resp"), ("Contributing", "Contrib"), ("Expiration", "Expiry"), ("Completion", "Compl"),
          ("Received", "Rcvd"), ("Generated", "Gen"), ("Response", "Resp"), ("Observations", "Obs"), ("Extension", "Ext"),
          ("Significant", "Signif"), ("Released", "Rel"), ("Contractor", "Contr"), ("Incident", "Inc"), ("Number", "No"),
          ("Material", "Matl"), ("Outstanding", "Open"), ("Relationship", "Rel"), ("Requested", "Req"), ("Contract", "Contr"),
          ("Section", "Sect"), ("Company", "Co"), ("Created", "Cr"), ("Approved", "Appr")]


def shorten(n):
    for a, b in ABBREV:
        if len(n) <= 26:
            break
        n = n.replace(a, b)
    return n


def tag():
    return str(uuid.uuid4())


def clean(col):
    words = re.findall(r"[A-Za-z0-9]+", col)
    name = "".join(w[:1].upper() + w[1:] for w in words)
    if name[:1].isdigit():
        name = "N" + name
    return name


def q(n):
    return f"'{n}'" if re.search(r"[^A-Za-z0-9_]", n) else n


def bt(ent):
    """Backing (TOM) table name of an entity: the gold table name unless aliased to avoid a clash."""
    return TABLE_ALIAS.get(ent, ENTITIES[ent][1])


def tidy(d):
    """Model-only markers (HIDDEN ...) mean nothing in the ontology; drop them."""
    for a, b in (("HIDDEN PRIMARY KEY. ", "Primary key. "), ("HIDDEN KEY. ", "Key. "), ("HIDDEN. ", "")):
        if d.startswith(a):
            d = b + d[len(a):]
    return d


# Semantic-model wording that means nothing (or misleads) in the ontology. Descriptions are merged from the Gold models,
# so they talk about inactive / limited relationships, USERELATIONSHIP, slicers and model measures. An agent reading the
# ontology took "go through the contract" as a draw-to-contract join (2026-10-09). Rewrite inline, then drop what's left.
_INLINE = [(r"\(active, limited, ", "("), (r"\(active, limited\)", ""), (r"\(active, ", "("), (r"\(inactive, ", "("),
           (r"\s*\((?:in)?active\)", ""), (r"\(limited relationship; ", "("), (r"\(limited relationship\):", ":"),
           (r"\(limited relationship, ", "("), (r" through an INACTIVE limited relationship", ""),
           (r" through an INACTIVE relationship", ""), (r" through a limited relationship", ""), (r"\(active; ", "(")]
_DROP = re.compile(r"USERELATIONSHIP|CROSSFILTER|TREATAS|slicer|active paths?\b|Reached from|pull these tables|DirectQuery|"
                   r"Analysis Services|\bMeasures?:|\bmeasures?\b(?! Code)|\bINACTIVE\b|\binactive\b|limited relationships?|"
                   r"\bthis report\b|\bvisuals?\b", re.I)


def ontologize(d):
    if not d:
        return d
    for a, b in _INLINE:
        d = re.sub(a, b, d)
    segs = re.split(r"(?<=[.;])\s+(?=[A-Z(\[0-9'])", d)
    d = " ".join(s for s in segs if not _DROP.search(s))
    return re.sub(r"\s{2,}", " ", d).strip()


# Entity-level notes for joins that agents get wrong. Written in ontology terms.
_TEXT_ID = ("(the IDs are stored as text there, so they are not declared relationships yet: match the number to the draw's "
            "SubDrawID / the contract's SubContractID)")
ENTITY_NOTE = {
    "SubcontractorDraw": "A draw has NO vendor and NO direct link to subcontractor contracts. Never join draws to contracts on "
                         "Project ID: a project has about 14 contracts (up to 52), so every draw would repeat per contract and "
                         "inflate totals. Draws and contracts meet ONLY through SubcontractorInvoice (one pay app per contract per "
                         "draw), SubcontractorPayment and LienWaiver, which carry both the draw ID and the contract ID "
                         + _TEXT_ID + ". Path for 'invoices by vendor for a project and month': draw (project + period) -> "
                         "SubcontractorInvoice -> SubcontractorContract -> vendor.",
    "SubcontractorContract": "The vendor lives on the contract ([Vendor ID] = Vista vendor in group 1, so Vendor Number = "
                             "'<Vendor ID>-1'). Each project has one owner-facing 'General Construction' contract with a blank "
                             "Vendor ID; exclude it for subcontract questions. A contract reaches its draws only through "
                             "SubcontractorInvoice, SubcontractorPayment and LienWaiver " + _TEXT_ID + "; never through the project.",
    "SubcontractorProject": "One project has many contracts and many draws; never join contracts to draws through the project. "
                            "The bridge between a draw and a contract is SubcontractorInvoice (or SubcontractorPayment / LienWaiver).",
    # 2026-10-09 phase 6
    "SubcontractorInvoice": "It is the bridge between draws and contracts: SubInvoiceDrawID points to SubcontractorDraw and SubInvoiceContractID to "
                            "SubcontractorContract " + _TEXT_ID + ". The vendor comes from the contract. "
                            "Amounts: SelfBilledAmountThisPeriod is the gross amount billed (before retention) and is the figure "
                            "to compare with Vista approved AP (also gross); NetInvoiceAmount is after retention. Exclude pay apps "
                            "with InvoiceStatus 'Rejected'. Paid, Available To Pay and On Hold (approved, payment held) pay apps "
                            "are approved and should be in Vista AP; Received and other pre-approval statuses are still in review. "
                            "When Textura and Vista AP differ, break the difference out by InvoiceStatus and draw so it reads as "
                            "'awaiting approval' rather than an unexplained gap. Show whole dollars, no cents.",
    "SubcontractorPayment": "SubPaymentDrawID and SubPaymentContractID point to SubcontractorDraw and SubcontractorContract " + _TEXT_ID + "; match "
                            "a payment to its invoice on contract + draw. The vendor comes from the contract.",
    "LienWaiver": "LienWaiverDrawID and LienWaiverContractID point to SubcontractorDraw and SubcontractorContract " + _TEXT_ID + "; sub-tier rows "
                  "have no contract and link only to the draw.",
    "SubcontractorChangeOrder": "SubChangeOrderContractID points to SubcontractorContract " + _TEXT_ID + ".",
    "SafetyIncident": "IncidentProcoreProjectID is the PROCORE project id: find the project by matching it to the Project's ProcoreID property "
                      "(97.3%), never to Project Number.",
    "SafetyInjury": "InjuryProcoreProjectID is the PROCORE project id: match it to the Project's ProcoreID (96.7%); or go through the incident.",
    "NearMiss": "NearMissProcoreProjectID is the PROCORE project id: match it to the Project's ProcoreID (98.4%); or go through the incident.",
    "ManpowerLog": "ManpowerProcoreProjectID and ManpowerProcoreVendorID hold PROCORE ids, not Vista numbers: match them to the Project's ProcoreID "
                   "(99.3%) and the Vendor's ProcoreVendorID (69.7% of non-blank), never to Project Number / Vendor Number.",
    "SafetyInspection": "InspectionProcoreProjectID is the PROCORE project id: match it to the Project's ProcoreID (95.9%).",
    "SafetyObservation": "ObsProcoreProjectID holds the PROCORE project id: match it to the Project's ProcoreID (99.2%), never to Project Number.",
    "Submittal": "SubmittalProcoreProjectID holds the PROCORE project id: match it to the Project's ProcoreID (97.8%), never to Project Number.",
    "TimeOffRequest": "Links to associates through Payroll Company + Viewpoint Employee ID (properties TimeOffPayrollCompany + TimeOffViewpointEmployeeID; not declared as a relationship; Associate "
                      "is keyed on email).",
    # 2026-10-09 IT time
    "TaskType": "Two separate IT effort entities carry a task type: ITTimeCardEntry (weekly time card hours, from 2025-12-28; any "
                "type) and ITTicketTimeWorked (ticket work-log time, from 2022-08-11; Incident, Request, Unknown only). They are "
                "different captures of different people: answer from one and say which; never add their hours together. 'Hours "
                "logged' on time cards = sum of ITTimeCardEntry TimeCardHours.",
    # 2026-10-10 hard-question test: MCP used Division Type as "Division", ranked WIP per company, double-listed JV jobs
    "Company": "Family > Division: Family = CompanyFamily and the Division IS the company itself, shown as '<CompanyNumber> - "
               "<CompanyLegalName>' (e.g. '34 - ARCO National Mission Critical & Infrastructure') and sorted by company number. "
               "DivisionType (Core Business, Business Line, Self-Perform, Design/Engineering, Center of Excellence; blank for "
               "about half the companies) only classifies a company: never group by it or call it the Division unless the "
               "user asks for division type. Always show the company number, because legal names repeat (two companies are "
               "named 'ARCO Pittsburgh'). Write labels with a plain hyphen, never an em dash.",
    "Project": "Show a project as '<ProjectNumber> - <ProjectName>' with a plain hyphen, never an em dash. Family and Division of "
               "a project come from its controlling company (Company entity). OfficeDivision is the Procore office division, not "
               "the Family > Division grouping.",
    "ProjectFinancialMonth": "Job WIP rules: (1) Report and rank WIP ONE ROW PER JOB: sum the companies of a job (a joint venture "
                             "books each partner's share in its own company, so one company row is only a partner's share; never "
                             "list the same job twice). (2) Current WIP = the last closed month (the previous month from the 20th "
                             "of the month on, otherwise the month before that); use only company rows dated in that month. A "
                             "company whose latest row is older carries a stale balance from a closed or finished piece of the job: "
                             "leave it out of current WIP. (3) To-date and estimate amounts (EstimatedContract, EstimatedCost, "
                             "CostToDate, BillingsToDate, OverUnderBillings, TotalBacklogRevenue) are balances: never add them "
                             "across months. (4) OverUnderBillings: positive = overbilled, negative = underbilled; % complete = "
                             "CostToDate / EstimatedCost summed over ONLY the company rows that have an EstimatedCost (a company row "
                             "with cost but no estimate, such as a joint venture entity that carries the whole job, must not add "
                             "its cost, or percent complete doubles). (5) If any company row of a job shows negative "
                             "BillingsToDate, add a note on that job saying the billing data looks wrong and the underbilling may be "
                             "overstated. When a partner row is shown on its own, label it as that company's share. (6) Cost here "
                             "is WIP monthly cost: it differs from job cost (the detailed job cost ledger, which is in the gold "
                             "warehouse and not in this ontology). For job cost, spend or cost booked by company, say the figure "
                             "is WIP cost and that job cost comes from the ARCO Data Agent or the Gold Financials report. Show whole "
                             "dollars, no cents.",
}
# entities whose ENTITY_NOTE describes value lookups: their "no links" line points to the note instead of forbidding all joins
LOOKUP_NOTE = {"SubcontractorInvoice", "SubcontractorPayment", "LienWaiver", "SubcontractorChangeOrder", "SafetyIncident",
               "ManpowerLog", "SafetyInspection", "SafetyObservation", "Submittal", "SafetyInjury", "NearMiss",
               "SubcontractorDraw", "SubcontractorContract", "TimeOffRequest"}


DESC_DROP["SupportSurveyResponse"] = [r"\s*The warehouse view adds four columns.*?\[Is Customer Satisfaction Rating\]\.",
                                      r"\s*\(4\) Survey comments are removed from the model[^.]*\.",
                                      r"\s*\(7\) Removed from the model:.*?Dim_SNOW_User\)\)\."]
ENTITY_NOTE.update({
    "SupportSurveyResponse": ("Satisfaction: use only rows of the three customer satisfaction SurveyTypes (ARCO Incident Survey, ARCO Customer "
        "Satisfaction Survey, Short Customer Satisfaction Survey using Smiley Face) whose SurveyQuestion is a Rating scaled 1 to 5, on "
        "completed surveys (SurveyIsCompletedSurvey true): 12,943 ratings, average 4.91 (2026-10-11). 89% of surveys expire unanswered "
        "(state canceled). Count surveys as distinct SurveyAsmtInstanceSysId values. The rated technician is the assignee of the "
        "triggering incident or requested item."),
    "ITProjectCostPlan": ("Amounts repeat at every level (portfolio, program, requirement, task): sum only lines with CostPlanIsLeafLevel "
        "true (leaf budget $253,988, actual $200,443). No changes since 2026-03-18; prefer ITProject cost properties for current totals."),
    "ITProjectSnapshot": ("Point-in-time: never add values across snapshot dates; pick one snapshot date (18 weekly snapshots, 2026-06-11 to "
        "2026-10-04). Actual start / end dates equal the planned dates on every row. The key is a row number that changes between loads."),
    "ITIncident": ("Timestamps are UTC as stored by ServiceNow (3.9% of incidents fall on a different US Central day). Priority 'Planning' is "
        "the default for self-service and email tickets. Count incidents by IncidentSysId, not ITIncidentNumber (41 numbers repeat)."),
    "ITProject": ("ServiceNow IT projects, not Vista construction jobs (the Project entity). Six 'ABS <Team> Operations' projects "
        "(PRJ0029230, PRJ0029231, PRJ0029232, PRJ0029233, PRJ0029235, PRJ0029406) are IT support buckets: exclude them for portfolio questions."),
})


# 2026-10-11 personal-data review (user: "do a full review of PII and remove"; Ontology/PII_Review_2026-10-11.md).
# REMOVED: personal names, emails, phones, logins / SSO ids, contact job titles, free text that names people (measured against
# the associate directory: IT incident / requested item / catalog task short descriptions name an employee on 22% / 25% / 54% of
# rows), and coded person IDs that are neither the entity key nor used by a relationship (they lead to a named person).
# KEPT + TAGGED: person identifiers that are an entity key or a RELS from / to column (removing them breaks the entity or link).
PII_REMOVE = {
    "Project": ("Created By ID", "Created By Login", "Created By Name"),
    "Company": ("Attorney Email", "Safety Contact"),
    "Vendor": ("Contact Name", "Email", "Vendor Notes"),
    "Customer": ("Contact", "Email"),
    "Associate": ("Employee Number", "Full Name", "Preferred Name", "Supervisor Employee Number", "Supervisor Full Name",
                  "Work Phone Number", "Work Phone Extension", "Work Phone Country", "Procore Employee ID"),
    "ITServiceUser": ("SNOW User Key", "User Name"),
    "ExpenseUser": ("Associate Name",),
    "ExpenseReport": ("Employee Key", "Expense Report Name"),
    "RecruitingUser": ("User Name",),
    "Referrer": ("Referrer User Number",),
    "Application": ("Coordinator User Number", "Rejected By User Number"),
    "Offer": ("Candidate Number",),
    "Opening": ("Hired Candidate Number",),
    "TimeOffRequest": ("Employee ID", "HR Reference"),
    "UnapprovedAPLine": ("Responsible Person", "Next Reviewer"),
    "ProjectSubcontract": ("Approved By",),
    "LegalMatter": ("Intake Owner Guid", "Intake Requester Guid", "Matter Contact Login Id", "Matter Contact Sso Id", "Paralegal",
                    "Title", "Description"),
    "ClientProtection": ("Created By Associate ID", "Approved By Associate ID", "Updated By Associate ID"),
    "SafetyIncident": ("Title", "Created By Id", "Created By Name"),
    "SafetyInjury": ("Incident Title", "Incident Created By Name", "Incident Created By Id"),
    "NearMiss": ("Incident Title", "Incident Created By Name", "Incident Created By Id"),
    "ManpowerLog": ("Contact ID", "Contact Name", "Contact Job Title", "Created By Name"),
    "SafetyInspection": ("Created By Name", "Created By Id", "Closed By Id", "Closed By Name", "Point Of Contact Name",
                         "Point Of Contact Id", "Reinspected By Id", "Description"),
    "SafetyObservation": ("Created By Name", "Assignee Name", "Assignee ID", "Description"),
    "Submittal": ("Submittal Manager Name", "Submittal Manager ID", "Received From Name"),
    "ITIncident": ("Opened By SNOW Sys Id", "Closed By SNOW Sys Id", "Resolved By SNOW Sys Id"),
    "ITServiceRequest": ("Closed By SNOW Sys Id",),
    "ITServiceTask": ("Closed By SNOW Sys Id",),
    "ServiceCatalogItem": ("Owner SNOW Sys Id",),
    "ITSupportGroup": ("Manager SNOW Sys Id",),
    "ITProject": ("Assigned To SNOW Sys Id",),
    "ITPortfolio": ("Portfolio Manager SNOW Sys Id",),
    "ITProgram": ("Program Manager SNOW Sys Id",),
    "ITDemand": ("Demand Manager SNOW Sys Id", "Submitter SNOW Sys Id", "Project Manager SNOW Sys Id"),
    "ITDemandTask": ("Assigned To SNOW Sys Id",),
    "ITEnhancement": ("Closed By SNOW Sys Id",),
    "ITProjectTask": ("Opened By SNOW Sys Id", "Closed By SNOW Sys Id"),
    "ITProjectSnapshot": ("Project Manager SNOW Sys Id",),
    "ITProjectRisk": ("Risk Owner SNOW Sys Id", "Assigned To SNOW Sys Id"),
    "ITProjectChange": ("Assigned To SNOW Sys Id",),
    "ITDecision": ("Assigned To SNOW Sys Id",),
    "ITTicketTimeWorked": ("SNOW User Key",),
    "ITTimeCardEntry": ("SNOW User Key", "Approved By SNOW Sys Id"),
}
for _e, _cols in PII_REMOVE.items():
    _s, _t, _k, _d, _x = ENTITIES[_e]
    ENTITIES[_e] = (_s, _t, _k, _d, tuple(_x) + tuple(c for c in _cols if c not in _x))
# kept because they are the entity key or a relationship column: tagged so agents count / group, never list people
_PID = "Personal identifier: {}; count or group by it, never list people."
PII_TAG = {
    ("Associate", "Email Address"): "the work email of the employee (entity key)",
    ("Associate", "Concur Employee ID"): "the employee's expense system ID (link target for expense reports and users)",
    ("Associate", "ARCO Hub User ID"): "the employee's ARCO Hub user ID (link target for CRM account owners)",
    ("Associate", "ServiceNow Sys Id"): "the employee's ServiceNow user ID (link to ITServiceUser)",
    ("Associate", "Greenhouse User Number"): "the employee's recruiting system user ID (link to RecruitingUser)",
    ("ITServiceUser", "SNOW Sys Id"): "the ServiceNow user ID (entity key; target of the IT person links)",
    ("ExpenseUser", "Employee Number"): "the expense system employee ID (entity key; link to Associate)",
    ("ExpenseReport", "Employee Number"): "the submitter's expense system ID (link to Associate)",
    ("CRMAccount", "Owner Associate ID"): "the account owner's ARCO Hub user ID (link to Associate)",
    ("RecruitingUser", "User Number"): "the recruiting user ID (entity key; link target)",
    ("Referrer", "Referrer Number"): "the referrer ID (entity key of a person)",
    ("Candidate", "Candidate Number"): "the candidate ID (entity key of a person)",
    ("Application", "Candidate Number"): "the candidate ID (link to Candidate)",
    ("Application", "Recruiter User Number"): "the recruiter's user ID (link to RecruitingUser)",
    ("Application", "Referrer Number"): "the referrer ID (link to Referrer)",
    ("ITTicketTimeWorked", "SNOW Sys Id"): "the ServiceNow ID of the person who logged the time (link to ITServiceUser)",
    ("ITTimeCardEntry", "SNOW Sys Id"): "the ServiceNow ID of the time card owner (link to ITServiceUser)",
    ("ITIncident", "Assigned To SNOW Sys Id"): "the assignee's ServiceNow ID (link to ITServiceUser)",
    ("ITIncident", "Caller SNOW Sys Id"): "the caller's ServiceNow ID (link to ITServiceUser)",
    ("ITServiceRequest", "Requested For SNOW Sys Id"): "the ServiceNow ID of the person the item is for (link to ITServiceUser)",
    ("ITServiceRequest", "Assigned To SNOW Sys Id"): "the assignee's ServiceNow ID (link to ITServiceUser)",
    ("ITServiceTask", "Assigned To SNOW Sys Id"): "the assignee's ServiceNow ID (link to ITServiceUser)",
    ("ITProject", "Project Manager SNOW Sys Id"): "the IT project manager's ServiceNow ID (link to ITServiceUser)",
    ("ITProjectTask", "Assigned To SNOW Sys Id"): "the assignee's ServiceNow ID (link to ITServiceUser)",
    ("ITDemand", "Assigned To SNOW Sys Id"): "the assignee's ServiceNow ID (link to ITServiceUser)",
    ("ITEnhancement", "Assigned To SNOW Sys Id"): "the assignee's ServiceNow ID (link to ITServiceUser)",
    ("SupportSurveyResponse", "Respondent SNOW Sys Id"): "the respondent's ServiceNow ID (link to ITServiceUser)",
}
# 2026-10-11 restored after the removal (user: "put these two back, just tagged"): full tag text, used verbatim
_SD = ("Sensitive: free text that names an employee on about {}% of rows (incidents 22%, requested items 25%, catalog tasks 54%); "
       "use it to summarise themes and top issues, never quote it or list it in answers about individuals.")
_PIDJ = "Personal identifier: use only to group or join (e.g. time off by department); never list people."
PII_TAG.update({
    ("ITIncident", "Short Description"): _SD.format(22),
    ("ITServiceRequest", "Short Description"): _SD.format(25),
    ("ITServiceTask", "Short Description"): _SD.format(54),
    ("TimeOffRequest", "Viewpoint Employee ID"): _PIDJ,
    ("Associate", "Viewpoint Employee ID"): _PIDJ,
})
for _k, _v in PII_TAG.items():
    COL_NOTE[_k] = _v if _v.startswith(("Sensitive:", "Personal identifier:")) else _PID.format(_v)
# the model text of the restored columns already says "Sensitive" / mentions the removed [Employee Number]: plain overrides,
# so the tag above is appended (the note is skipped when its label already appears in the description)
COL_DESC.update({
    ("ITIncident", "Short Description"): "Free text as typed in ServiceNow (up to 160 characters); never blank.",
    ("ITServiceRequest", "Short Description"): "Free text as typed in ServiceNow (up to 160 characters); filled on 38,531 of 38,533 rows.",
    ("ITServiceTask", "Short Description"): "Free text as typed in ServiceNow (up to 160 characters); filled on 102,073 of 102,080 rows.",
    ("Associate", "Viewpoint Employee ID"): ("Vista payroll employee number (int). NOT unique alone (380 IDs exist in several companies); "
        "unique together with CompanyCode. Time off requests reach the associate on their Payroll Company + Viewpoint Employee ID = "
        "this associate's CompanyCode + this ID (2,674 of 2,690 requesters, 99.4%; 94.9% of hours, 2026-10-11). Blank for 32 associates; never match blanks."),
})
# removing Associate[Employee Number] frees the name 'EmployeeNumber': pin the live (truncated) name so the lineage tag carries over
PROP_NAME[("ExpenseReport", "Employee Number")] = "ExpenseReportEmployeeNumbe"
PROP_NAME[("ExpenseUser", "Employee Number")] = "ExpenseUserEmployeeNumber"
COL_NOTE[("ExpenseReport", "Report Purpose")] = "Sensitive: employee free text that occasionally names people; summarize, do not list values."
# notes that described (or told agents to use) a removed property
for _k in [("UnapprovedAPLine", "Responsible Person"), ("UnapprovedAPLine", "Next Reviewer"), ("LegalMatter", "Description"),
           ("LegalMatter", "Title"), ("SafetyIncident", "Title"), ("SafetyIncident", "Created By Name"), ("SafetyInjury", "Incident Title"),
           ("SafetyInjury", "Incident Created By Name"), ("NearMiss", "Incident Title"), ("NearMiss", "Incident Created By Name"),
           ("ManpowerLog", "Created By Name"), ("SafetyInspection", "Description"), ("SafetyObservation", "Description"),
           ("ITTicketTimeWorked", "SNOW User Key"), ("ITTimeCardEntry", "SNOW User Key")]:
    COL_NOTE.pop(_k, None)
for _k in [("ITServiceUser", "SNOW User Key"), ("TimeOffRequest", "Employee ID")]:
    COL_DESC.pop(_k, None)
# time-off-to-associate lookup restored 2026-10-11 (tagged), numbers re-measured on prod gold
COL_ADD[("TimeOffRequest", "Payroll Company")] = ("With Viewpoint Employee ID it finds the associate: match the associate's Company Code + "
                                                  "Viewpoint Employee ID (2,674 of 2,690 requesters, 99.4%; 94.9% of hours, 2026-10-11).")
COL_ADD[("TimeOffRequest", "Viewpoint Employee ID")] = ("To find the associate (department, company, work location), match Payroll Company + "
                                                        "this ID to the associate's Company Code + Viewpoint Employee ID (2,674 of 2,690 requesters, 99.4%; 94.9% of hours, 2026-10-11).")
ENTITY_NOTE["TimeOffRequest"] = ("Time off by department, company or location: match Payroll Company + Viewpoint Employee ID (properties "
    "TimeOffPayrollCompany + TimeOffViewpointEmployeeID) to the Associate's CompanyCode + ViewpointEmployeeID (2,674 of 2,690 requesters, 99.4%; 94.9% of hours, 2026-10-11). Not a "
    "declared relationship: neither ID is unique alone and Associate is keyed on email. Group or count requesters by that pair; "
    "never list people.")
LOOKUP_NOTE.add("TimeOffRequest")
LEAD["LegalMatter"] = LEAD["LegalMatter"].replace("Title and Description are CONFIDENTIAL free text: never quote or list them.",
                                                  "Matter titles, descriptions and contact people are not included (confidential).")
# inline mentions of removed columns inside sentences worth keeping (drop_removed drops whole sentences otherwise)
DESC_DROP.setdefault("LegalMatter", []).append(r",? \[Intake Owner Guid\] always blank")
DESC_DROP.setdefault("Customer", []).append(r"\(4\) Contact, email and phone columns are business contact details; mostly blank\.\s*")
# Associate: the model text says "No PII" and points to removed IDs; replace it with the HR-safe wording (DESC_DROP empties it)
DESC_DROP["Associate"] = [r"(?s)^.*$"]
LEAD["Associate"] = ("Associate: an ARCO employee in the HR-safe directory: work attributes only (company, department, work location, "
                     "job title, status); personal names and contacts are not included. Source UKG, one row per associate, key "
                     "EmailAddress (work email), unique and always filled. Crosswalk IDs reach the associate from other systems: "
                     "ConcurEmployeeID (expenses), ARCOHubUserID (CRM), ServiceNowSysId (IT service), GreenhouseUserNumber "
                     "(recruiting). A blank crosswalk ID must never be matched to associates whose ID is also blank. Count or group "
                     "associates; never list people.")
_bad = [(e, c) for e, (s, t, k, d, x) in ENTITIES.items() for c in x if c == k]
_bad += [(r[0], c) for r in RELS for e, c in ((r[1], r[2]), (r[3], r[4])) if c in ENTITIES[e][4]]
assert not _bad, f"PII removal would drop a key or relationship column: {_bad}"


def drop_removed(ent, d):
    """Drop sentences / clauses of merged model text that name a column removed as personal data (2026-10-11), so no
    description points agents at a property the ontology no longer has."""
    gone = PII_REMOVE.get(ent, ())
    if not d or not gone:
        return d
    segs = re.split(r"(?<=[.;])\s+(?=[A-Z(\[0-9'])", d)
    d = " ".join(sg for sg in segs if not any("[" + g + "]" in sg for g in gone))
    return re.sub(r"\s{2,}", " ", d).strip()


def load_descriptions(table, entity):
    """Pull /// column + table descriptions from the described semantic-model TMDL, if present.
    Columns match by model column name and by sourceColumn (= gold column); model overview (MODEL:) lines are dropped."""
    p = os.path.join(DESC_ROOT, DESC_MODEL.get(entity, "Gold Shared Dimensions"), "definition", "tables", f"{table}.tmdl")
    if not os.path.exists(p):
        return None, {}
    lines = open(p, encoding="utf-8").read().replace("\r\n", "\n").split("\n")
    cols, buf, tdesc, cur = {}, [], None, None
    for ln in lines:
        s = ln.strip()
        if s.startswith("///"):
            buf.append(s[3:].strip())
            continue
        m = re.match(r"^\tcolumn ('([^']+)'|([^\s=]+))", ln)
        if m:
            cur = tidy(" ".join(buf)) if buf else None
            if cur:
                cols[m.group(2) or m.group(3)] = cur
        elif cur and ln.startswith("\t\tsourceColumn:"):
            cols.setdefault(ln.split(":", 1)[1].strip(), cur)
        elif ln.startswith("table ") and buf:
            tdesc = " ".join(b for b in buf if not b.startswith(("MODEL:", "MODEL OVERVIEW")))
        elif re.match(r"^\t\S", ln):
            cur = None
        if s:
            buf = []
    return tdesc or None, cols


def wr(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8", newline="\n").write(text)


def build(display_name="ARCO_Gold_Ontology"):
    cols_by_table = {}
    for s, t, c, ty, o in INV["cols"]:
        cols_by_table.setdefault((s, t), []).append((c, ty))

    # property names must be unique across all entity types: prefix with entity name on collision
    counts = {}
    for ent, (s, t, key, _, excl) in ENTITIES.items():
        if ent not in PHASE1:
            continue
        for c, _ in cols_by_table[(s, t)]:
            if c not in excl:
                counts[clean(c)] = counts.get(clean(c), 0) + 1
    pname = {}
    for ent, (s, t, key, _, excl) in ENTITIES.items():
        for c, _ in cols_by_table[(s, t)]:
            if c in excl:
                continue
            n = clean(c)
            if (ent, c) in PROP_NAME:
                n = PROP_NAME[(ent, c)]
            elif ent in PHASE1:
                if counts[n] > 1:
                    n = ent + n
            elif ent in FORCE_PREFIX:
                # 2026-10-11 IT operations: always prefixed (State, Priority... exist on most of them); no doubled word
                p = PREFIX[ent]
                for a, b in (("SNOWSysId", "SysId"), ("AssignmentGroup", "Group"), ("AssignedTo", "Assignee"),
                             ("ProjectManager", "PM"), ("ITProjectSnapshot", "Snapshot"), ("ServiceRequestItem", "ReqItem"),
                             ("CostPlanBreakdown", "CostPlanLine")):
                    n = n.replace(a, b)
                for a, b in (("Assessment", "Asmt"), ("Percentage", "Pct"), ("Seconds", "Secs"), ("Duration", "Dur"),
                             ("Category", "Cat"), ("BusinessCommittee", "Committee"), ("StrategicAlignment", "Strategy"),
                             ("ParentGroup", "Parent"), ("Estimated", "Est")):
                    if len(p + n) > 26:
                        n = n.replace(a, b)
                for k in range(len(p)):
                    if p[k].isupper() and n.startswith(p[k:]):
                        n = p[:k] + n
                        break
                else:
                    n = p + n
                n = shorten(n)
            elif ent in READABLE:
                # 2026-10-09+: collisions checked case-insensitively; long names abbreviated (readable), not cut mid-word
                used = {v.lower() for v in pname.values()}
                n = n.replace("Subcontracted", "Subcon")  # Textura 'Subcontracted ...' (lower-tier / roll-up) amounts
                if n.lower() in used:
                    n = PREFIX.get(ent, ent) + n
                n = shorten(n)
                if n.lower() in used and not n.startswith(PREFIX.get(ent, ent)):
                    n = shorten(PREFIX.get(ent, ent) + clean(c))
            elif n in set(pname.values()):
                n = PREFIX.get(ent, ent) + n
            if len(n) > 26:
                if ent in READABLE:
                    print("WARN truncated property name", ent, c, n)
                n = n[:26]
            pname[(ent, c)] = n
    _dup = [v for v in set(pname.values()) if list(pname.values()).count(v) > 1]
    assert not _dup, f"property name collision after truncation: {[(k, v) for k, v in pname.items() if v in _dup]}"
    new_names = [v for (e, _), v in pname.items() if e in READABLE]
    lower_all = [v.lower() for v in pname.values()]
    clash = [v for v in new_names if lower_all.count(v.lower()) > 1]
    assert not clash, f"case-insensitive property name collision: {clash}"

    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "**", "*.tmdl"), recursive=True):
        os.remove(f)
    wr(os.path.join(OUT, ".platform"), json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {"type": "Ontology", "displayName": display_name},
        "config": {"version": "2.0", "logicalId": "00000000-0000-0000-0000-000000000000"}}, indent=2))
    wr(os.path.join(OUT, "database.tmdl"), "database\n\tcompatibilityLevel: 1000000\n")
    wr(os.path.join(OUT, "namespaces", "default.tmdl"), "namespace default\n\tlineageTag: default\n")
    wr(os.path.join(OUT, "expressions.tmdl"),
       f'expression \'DirectLake - gold\' =\n\t\tlet\n\t\t    Source = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/{WORKSPACE_ID}/{GOLD_WAREHOUSE_ID}", [HierarchicalNavigation=true])\n'
       f"\t\tin\n\t\t    Source\n\tlineageTag: {tag()}\n")

    # relationships that will actually be written (same type check as below), for the per-entity "Ontology links" line
    live_rels = []
    for rname, fe, fc, te, tc, ename, rdesc in RELS:
        ftype = dict(cols_by_table[(ENTITIES[fe][0], ENTITIES[fe][1])])[fc]
        ttype = dict(cols_by_table[(ENTITIES[te][0], ENTITIES[te][1])])[tc]
        if TYPE[ftype] == TYPE[ttype]:
            live_rels.append((fe, te, ename))

    def links_line(ent):
        out = [f"'{n}' (to {te})" for fe, te, n in live_rels if fe == ent] + [f"'{n}' (from {fe})" for fe, te, n in live_rels if te == ent]
        if not out and ent in LOOKUP_NOTE:
            return ("Ontology links: none declared yet; use only the ID lookups described above, never other shared columns.")
        if not out:
            return "Ontology links: none yet; do not join this entity to others on shared columns."
        if ent in LOOKUP_NOTE:
            return ("Ontology links: " + ", ".join(out) + ". These are the only declared joins; beyond them use only the ID "
                    "lookups described above, never other shared columns.")
        return "Ontology links: " + ", ".join(out) + ". These are the only declared joins; do not join to other entities on shared columns."

    model = ["model Model", ""]
    for ent, (s, t, key, edesc, excl) in ENTITIES.items():
        tdesc, cdesc = load_descriptions(t, ent)
        tn = q(bt(ent))
        tbl = [f"table {tn}", f"\tlineageTag: {tag()}", ""]
        prop = []
        for c, ty in cols_by_table[(s, t)]:
            if c in excl:
                continue
            n, dt = pname[(ent, c)], TYPE.get(ty, "string")
            tbl += [f"\tcolumn {q(c)}", f"\t\tdataType: {dt}", f"\t\tsourceColumn: {c}", f"\t\tlineageTag: {tag()}", ""]
            d = COL_DESC.get((ent, c)) or drop_removed(ent, ontologize(cdesc.get(c)))
            if (ent, c) in COL_ADD:
                d = f"{d} {COL_ADD[(ent, c)]}" if d else COL_ADD[(ent, c)]
            note = COL_NOTE.get((ent, c))
            if note and not (d and note.rstrip(".").split(":")[0] in d):
                d = f"{d} {note}" if d else note
            src = f"Gold column: {s}.{t}[{c}]."
            prop.append(f"\t/// {d} {src}" if d else f"\t/// {src}")
            prop += [f"\tproperty {n}", f"\t\tdataType: {dt}", f"\t\tlineageTag: {tag()}",
                     "\t\tbackingConfiguration", f"\t\t\tvalueColumn: {tn}.{q(c)}", ""]
        tbl += [f"\tpartition {tn} = entity", "\t\tmode: directLake", "\t\tsource", f"\t\t\tentityName: {t}",
                f"\t\t\tschemaName: {s}", "\t\t\texpressionSource: 'DirectLake - gold'", "",
                # Fabric reads the source item kind from these annotations (format copied from a UI-made binding, 2026-10-05)
                f"\t\tannotation ONT_WorkspaceId = {WORKSPACE_ID}", "", f"\t\tannotation ONT_ItemId = {GOLD_WAREHOUSE_ID}", "",
                "\t\tannotation ONT_ItemKind = Warehouse", "", "\t\tannotation ONT_ItemName = gold", "",
                "\t\tannotation ONT_WorkspaceName = ARCO DWH", "", f"\t\tannotation ONT_PinnedAtUtc = {PINNED}", ""]
        wr(os.path.join(OUT, "tables", f"{bt(ent)}.tmdl"), "\n".join(tbl))
        desc = ontologize(tdesc) or edesc
        for pat in DESC_DROP.get(ent, ()):  # applied after ontologize (model wording is rewritten first)
            desc = re.sub(pat, "", desc)
        desc = drop_removed(ent, desc)
        if ent in LEAD:
            desc = LEAD[ent] + " " + desc
        if ent in ENTITY_NOTE:
            desc += " " + ENTITY_NOTE[ent]
        desc += " " + links_line(ent)
        if len(desc) > 3990:
            # Fabric rejects entity descriptions over 4,000 characters (2026-10-11: ProjectFinancialMonth hit 4,937 after the
            # Job Cost re-description). Keep the links line; cut the merged model text at the last sentence that fits.
            ll = " " + links_line(ent)
            body = desc[: len(desc) - len(ll)]
            cut = body[: 3990 - len(ll) - 40]
            cut = cut[: cut.rfind(". ") + 1] if ". " in cut else cut
            desc = cut + " (Description shortened; see the Gold model.)" + ll
            print("NOTE shortened description", ent, len(desc))
        ent_lines = [f"/// {desc}", f"entity {ent}", f"\tlineageTag: {tag()}", f"\tbackingTable: {tn}",
                     f"\tkeyProperty: {pname[(ent, key)]}", ""] + prop
        wr(os.path.join(OUT, "entities", f"{ent}.tmdl"), "\n".join(ent_lines))
        model += [f"ref table {tn}", f"ref entity {ent}"]
    model += ["", "ref namespace default", ""]
    wr(os.path.join(OUT, "model.tmdl"), "\n".join(model))

    rel, erel = [], []
    for rname, fe, fc, te, tc, ename, rdesc in RELS:
        ft, tt = q(bt(fe)), q(bt(te))
        ftype = dict(cols_by_table[(ENTITIES[fe][0], ENTITIES[fe][1])])[fc]
        ttype = dict(cols_by_table[(ENTITIES[te][0], ENTITIES[te][1])])[tc]
        if TYPE[ftype] != TYPE[ttype]:
            print('SKIP (type mismatch)', rname, ftype, ttype); continue
        rel += [f"relationship {rname}", f"\tfromColumn: {ft}.{q(fc)}", f"\ttoColumn: {tt}.{q(tc)}", ""]
        erel += [f"/// {rdesc}", f"entityRelationship {q(ename)}", f"\tlineageTag: {tag()}", f"\tfromEntity: {fe}",
                 f"\ttoEntity: {te}", "\tbackingConfiguration", f"\t\trelationship: {rname}", ""]
    wr(os.path.join(OUT, "relationships.tmdl"), "\n".join(rel))
    wr(os.path.join(OUT, "entityRelationships.tmdl"), "\n".join(erel))
    return {e: sum(1 for k in pname if k[0] == e) for e in ENTITIES}


if __name__ == "__main__":
    print(build())
