/*
 * The role library behind the New Role wizard's first two steps — Role and Responsibilities.
 *
 * Ported from the reference New Role build (the Veolia CPA offline HTML), which
 * keeps this library in the bundle: the four roles an analyst can play, what each is responsible for
 * (areas, each with its tasks), the industries a role works in, the utilities found in the connected
 * data, and what reading an uploaded job description turns up. Nothing here is served by the mock
 * server, so it is authored data — the figures under UTILITIES are the Northline Water Group tenant's.
 */

export interface RoleArea {
  id: string
  name: string
  what: string
  tasks: string[]
}

export interface JdFinding {
  id: string
  kind: 'confirm' | 'task' | 'scope'
  text: string
  quote: string
  area?: string
  value?: string
  reason?: string
}

export interface RoleDef {
  id: string
  name: string
  blurb: string
  areas: RoleArea[]
  jd: { file: string; pages?: number; findings: JdFinding[] }
}

export interface IndustryDef {
  id: string
  name: string
  note: string
}

export interface UtilityDef {
  code: string
  name: string
  region: string
  commission: string
  projects: number
  approvedB: number
  preselect: boolean
}

export interface UtilityScan {
  steps: string[]
  found: UtilityDef[]
  none?: string
}

export let ROLES: RoleDef[] = [
  {
    "id": "cpa",
    "name": "Capital Program Analyst",
    "blurb": "Plans, funds, tracks and reports the capital program across thousands of projects, and supports rate cases with the evidence behind them.",
    "areas": [
      {
        "id": "cip",
        "name": "Capital plan (CIP)",
        "what": "Builds and keeps the 5-year capital improvement plan from master plans, asset needs, mandates and growth.",
        "tasks": [
          "Collect project requests from engineering and operations",
          "Maintain the 5-year CIP and its annual update",
          "Calendarize spend by month (Jan Calendarization)",
          "Tie projects to mandates (lead service lines, PFAS treatment)",
          "Track what changed between plan vintages"
        ]
      },
      {
        "id": "prior",
        "name": "Prioritization and business cases",
        "what": "Ranks projects by risk and value and makes the case for the funded list.",
        "tasks": [
          "Score projects on asset risk, compliance and customer value",
          "Recommend the funded list within each utility envelope",
          "Prepare business cases for the WIN gate",
          "Record the alternatives considered"
        ]
      },
      {
        "id": "budget",
        "name": "Budgeting and funding",
        "what": "Turns the plan into approved budgets and lines up the money to pay for them.",
        "tasks": [
          "Prepare the annual capital budget per utility",
          "Process WIN authorizations and budget transfers",
          "Track funding sources (SRF loans, WIFIA, PFAS grants, contributions)",
          "Forecast capital cash flow for Treasury"
        ]
      },
      {
        "id": "cost",
        "name": "Cost tracking and forecasting",
        "what": "Keeps actuals, commitments and forecasts current for every project and explains the variances.",
        "tasks": [
          "Report monthly actuals against plan and forecast",
          "Track commitments, open orders and retainage",
          "Keep the forecast at completion current with project managers",
          "Explain variances above threshold",
          "Track change orders and contingency use",
          "Check the program can spend the annual plan by December"
        ]
      },
      {
        "id": "sched",
        "name": "Schedule and delivery",
        "what": "Follows milestones and critical paths and what slippage does to spend.",
        "tasks": [
          "Track milestones against the baseline schedule",
          "Flag critical path slippage and its effect on spend",
          "Follow stage gates from planning to close-out"
        ]
      },
      {
        "id": "reg",
        "name": "Rate case and regulatory support",
        "what": "Provides the capital schedules, eligible plant and evidence the four commissions ask for.",
        "tasks": [
          "Prepare capital schedules and rate base additions for rate cases",
          "Answer data requests from commission staff and intervenors",
          "Support DSIC and SIC surcharge filings with eligible plant",
          "Confirm in-service dates for projects claimed in a test year",
          "Keep the prudence record (decisions, alternatives, approvals)"
        ]
      },
      {
        "id": "acct",
        "name": "Capital accounting and close-out",
        "what": "Keeps CWIP, AFUDC and plant in service right and closes finished projects.",
        "tasks": [
          "Apply the capitalization policy (capital or expense)",
          "Review CWIP balances and AFUDC",
          "Move completed projects to plant in service",
          "Close out finished projects and release unused budget",
          "Record retirements of replaced assets"
        ]
      },
      {
        "id": "comp",
        "name": "Grant and loan compliance",
        "what": "Keeps SRF, WIFIA and PFAS grant work compliant and draws the money on time.",
        "tasks": [
          "Prepare SRF and WIFIA draw requests",
          "Track Davis-Bacon and Build America, Buy America records",
          "Report lead service line replacement progress",
          "Report to lenders and funding agencies"
        ]
      },
      {
        "id": "report",
        "name": "Program reporting",
        "what": "Tells the Capital Steering Committee, leadership and the commissions where the program stands.",
        "tasks": [
          "Write the monthly capital program report",
          "Prepare the quarterly Capital Steering Committee review",
          "Answer ad hoc questions from leadership",
          "Keep the program dashboard current"
        ]
      }
    ],
    "jd": {
      "file": "Northline_Job_Description_Capital_Program_Analyst.pdf",
      "pages": 4,
      "findings": [
        {
          "id": "j1",
          "kind": "confirm",
          "text": "Confirms 8 of your 9 areas: plan, prioritization, budgets, cost and forecast, schedule, rate cases, close-out and reporting.",
          "quote": "“Maintains the capital plan, tracks cost and forecast for every project and supports rate case filings with capital schedules.”"
        },
        {
          "id": "j2",
          "kind": "task",
          "area": "cost",
          "text": "Add a task to Cost tracking and forecasting: review contractor claims and change order requests before WIN approval.",
          "quote": "“Reviews contractor claims and change order requests against the contract before they go to WIN approval.”",
          "value": "Review contractor claims and change order requests before WIN approval"
        },
        {
          "id": "j3",
          "kind": "scope",
          "area": "comp",
          "text": "Take Grant and loan compliance out of scope. Treasury prepares SRF and WIFIA draws and keeps the compliance records.",
          "quote": "“SRF and WIFIA draws and their compliance records are prepared by Treasury; the analyst supplies eligible spend on request.”",
          "reason": "Done by another team"
        }
      ]
    }
  },
  {
    "id": "reg",
    "name": "Regulatory Analyst",
    "blurb": "Prepares rate cases and compliance filings for the four commissions, answers their staff and tracks what the company owes them.",
    "areas": [
      {
        "id": "rc",
        "name": "Rate case preparation",
        "what": "Builds revenue requirement and cost of service schedules for filings.",
        "tasks": [
          "Build revenue requirement schedules",
          "Prepare cost of service and rate design inputs",
          "Assemble the test year"
        ]
      },
      {
        "id": "dr",
        "name": "Data requests and discovery",
        "what": "Answers staff and intervenor questions on time with evidence.",
        "tasks": [
          "Log and route data requests",
          "Draft responses with supporting evidence",
          "Track due dates"
        ]
      },
      {
        "id": "filings",
        "name": "Compliance filings",
        "what": "Files the reports each commission requires.",
        "tasks": [
          "Prepare the annual report to each commission",
          "File tariff changes",
          "Keep the filing calendar"
        ]
      },
      {
        "id": "riders",
        "name": "Surcharges and riders",
        "what": "Runs DSIC, SIC and other adjustment mechanisms within their caps.",
        "tasks": [
          "Calculate surcharge rates each quarter",
          "Reconcile rider revenue to cost"
        ]
      },
      {
        "id": "watch",
        "name": "Regulatory monitoring",
        "what": "Follows orders, rulemakings and their deadlines.",
        "tasks": [
          "Track orders and their obligations",
          "Summarize rulemakings that affect the company"
        ]
      }
    ],
    "jd": {
      "file": "Northline_Job_Description_Regulatory_Analyst.pdf",
      "pages": 3,
      "findings": [
        {
          "id": "rj1",
          "kind": "confirm",
          "text": "Confirms 4 of your areas: rate cases, data requests, compliance filings and riders.",
          "quote": "“Prepares revenue requirement schedules and responds to data requests.”"
        },
        {
          "id": "rj2",
          "kind": "task",
          "area": "filings",
          "text": "Add a task to Compliance filings: prepare the annual service quality report.",
          "quote": "“Prepares the annual service quality report for each commission.”",
          "value": "Prepare the annual service quality report"
        }
      ]
    }
  },
  {
    "id": "sca",
    "name": "Supply Chain Analyst",
    "blurb": "Keeps pipe, meters, chemicals and spares available at the right cost and tracks supplier performance.",
    "areas": [
      {
        "id": "demand",
        "name": "Materials demand planning",
        "what": "Forecasts what capital and operations will need and when.",
        "tasks": [
          "Forecast pipe, fittings and meters from the capital plan",
          "Forecast chemical use by plant"
        ]
      },
      {
        "id": "inv",
        "name": "Inventory management",
        "what": "Keeps stock and critical spares at the right level.",
        "tasks": [
          "Set reorder points",
          "Watch critical spares",
          "Find slow-moving stock"
        ]
      },
      {
        "id": "supplier",
        "name": "Supplier performance",
        "what": "Measures delivery and quality by supplier.",
        "tasks": [
          "Track on-time delivery",
          "Track lead times",
          "Run quarterly supplier reviews"
        ]
      },
      {
        "id": "spend",
        "name": "Contract and spend analysis",
        "what": "Checks spend is under contract and at contract price.",
        "tasks": [
          "Measure spend under contract",
          "Find price variances against contract"
        ]
      },
      {
        "id": "chem",
        "name": "Chemical supply continuity",
        "what": "Makes sure treatment chemicals never run short.",
        "tasks": [
          "Track days of supply per plant",
          "Keep alternate suppliers ready"
        ]
      }
    ],
    "jd": {
      "file": "Northline_Job_Description_Supply_Chain_Analyst.pdf",
      "pages": 3,
      "findings": [
        {
          "id": "sj1",
          "kind": "confirm",
          "text": "Confirms all 5 of your areas.",
          "quote": "“Monitors inventory, supplier performance and chemical supply.”"
        },
        {
          "id": "sj2",
          "kind": "task",
          "area": "supplier",
          "text": "Add a task to Supplier performance: collect Build America, Buy America certifications for funded orders.",
          "quote": "“Collects BABA certifications from suppliers on SRF-funded orders.”",
          "value": "Collect BABA certifications for funded orders"
        }
      ]
    }
  },
  {
    "id": "fa",
    "name": "Financial Analyst",
    "blurb": "Runs the operating budget and forecast, explains variances and reports unit costs and revenue.",
    "areas": [
      {
        "id": "budget",
        "name": "Operating budget and forecast",
        "what": "Builds the O&M budget and keeps the forecast current.",
        "tasks": [
          "Prepare the O&M budget",
          "Update the monthly forecast"
        ]
      },
      {
        "id": "close",
        "name": "Month-end variance analysis",
        "what": "Explains actuals against budget after close.",
        "tasks": [
          "Explain variances by department",
          "Review accruals with Accounting"
        ]
      },
      {
        "id": "revenue",
        "name": "Revenue and consumption",
        "what": "Tracks billed revenue and demand against forecast.",
        "tasks": [
          "Compare billed revenue with forecast",
          "Watch consumption by customer class"
        ]
      },
      {
        "id": "mgmt",
        "name": "Management reporting",
        "what": "Reports financial results to leadership.",
        "tasks": [
          "Monthly financial report",
          "Board financial summary"
        ]
      }
    ],
    "jd": {
      "file": "Northline_Job_Description_Financial_Analyst.pdf",
      "pages": 3,
      "findings": [
        {
          "id": "fj1",
          "kind": "confirm",
          "text": "Confirms all 4 of your areas.",
          "quote": "“Prepares the O&M budget, monthly variance analysis and management reports.”"
        },
        {
          "id": "fj2",
          "kind": "task",
          "area": "close",
          "text": "Add a task to Month-end variance analysis: reconcile chemical and power costs to plant usage.",
          "quote": "“Reconciles chemical and power costs to plant usage monthly.”",
          "value": "Reconcile chemical and power costs to usage"
        }
      ]
    }
  }
]

export let INDUSTRIES: IndustryDef[] = [
  {
    "id": "water",
    "name": "Water",
    "note": "Drinking water: treatment, storage and distribution"
  },
  {
    "id": "wastewater",
    "name": "Wastewater",
    "note": "Collection and treatment"
  },
  {
    "id": "electricity",
    "name": "Electricity",
    "note": "Generation, transmission and distribution"
  },
  {
    "id": "gas",
    "name": "Natural gas",
    "note": "Transmission and distribution"
  },
  {
    "id": "transit",
    "name": "Transport and transit",
    "note": "Bus, rail and tram networks"
  }
]

export let UTILITIES: Record<string, UtilityScan> = {
  "water": {
    "steps": [
      "Reading pmo.project in the PMO project master: 4,500 projects, 5 utility codes",
      "Matching utility codes to pmo.utility: 4 regulated water utilities and 1 shared services division",
      "Reading the commission and region for each one",
      "Counting approved projects and budget per utility in epbcs.plan"
    ],
    "found": [
      {
        "code": "ARD",
        "name": "Northline Water of Ardenia",
        "region": "Northvale Region",
        "commission": "Ardenia Public Service Commission (APSC)",
        "projects": 1111,
        "approvedB": 1.88,
        "preselect": true
      },
      {
        "code": "BEL",
        "name": "Northline Water of Belmara",
        "region": "Eastmoor Region",
        "commission": "Belmara Public Utility Commission (BPUC)",
        "projects": 1100,
        "approvedB": 2.18,
        "preselect": true
      },
      {
        "code": "COR",
        "name": "Northline Water of Corvale",
        "region": "Cascadia Region",
        "commission": "Corvale Utilities Commission (CUC)",
        "projects": 1100,
        "approvedB": 1.83,
        "preselect": true
      },
      {
        "code": "DUN",
        "name": "Northline Water of Dunmoor",
        "region": "Lakeshore Region",
        "commission": "Dunmoor Public Service Commission (DPSC)",
        "projects": 1114,
        "approvedB": 2.32,
        "preselect": true
      },
      {
        "code": "SSD",
        "name": "Shared Services Division",
        "region": "No region",
        "commission": "Not regulated",
        "projects": 75,
        "approvedB": 0.06,
        "preselect": false
      }
    ]
  },
  "wastewater": {
    "steps": [
      "Reading pmo.project in the PMO project master: 4,500 projects",
      "Looking for wastewater programs and assets"
    ],
    "found": [],
    "none": "No wastewater utilities in the connected data. pmo.project holds water projects only. Pick Water, or connect the wastewater systems first."
  },
  "electricity": {
    "steps": [
      "Reading pmo.project in the PMO project master: 4,500 projects",
      "Looking for electric utilities"
    ],
    "found": [],
    "none": "No electric utilities in the connected data. Northline Water Group runs water utilities only."
  },
  "gas": {
    "steps": [
      "Reading pmo.project in the PMO project master: 4,500 projects",
      "Looking for gas utilities"
    ],
    "found": [],
    "none": "No gas utilities in the connected data. Northline Water Group runs water utilities only."
  },
  "transit": {
    "steps": [
      "Reading pmo.project in the PMO project master: 4,500 projects",
      "Looking for transit networks and operators"
    ],
    "found": [],
    "none": "No transit networks in the connected data. Northline Water Group runs water utilities only."
  }
}

/** Why a responsibility is taken out of scope — the chips under an unticked area. */
export let OUT_REASONS: string[] = ["Done by another team","Not something we do here","Later, not now"]

/*
 * **The bundled library above is the default; a dataset that ships its own replaces it.** CAPEX's
 * Northline export carries a `new_role` block (roles, industries, what a scan finds, which domain each
 * role works in) and the server serves it on `GET /role-library`. `hydrateRoleLibrary` swaps it in.
 *
 * The four exports above are `let` for that: ES module bindings are live, so one assignment reaches
 * every importer — the same arrangement the report prototype's dataset has — and it holds only
 * because nothing reads them at module scope, which was checked before the change.
 */

/** Role id → the business domain it works in, as the shipped library names it. */
export let ROLE_DOMAIN_OF: Record<string, string> = {}

const FINDING_KINDS = ['confirm', 'task', 'scope']

/**
 * Take a served library into use. Read defensively and all-or-nothing: a library missing its roles or
 * industries is ignored rather than half-applied, because a half-replaced one would offer roles whose
 * industries are the bundled library's.
 */
export function hydrateRoleLibrary(raw: unknown): boolean {
  const lib = raw as {
    roles?: Array<Partial<RoleDef> & { jd?: { file?: string; pages?: number; findings?: JdFinding[] } }>
    industries?: IndustryDef[]
    discovery?: Record<string, UtilityScan>
    domain_of_role?: Record<string, string>
    steps?: Array<{ key?: string; out_reasons?: string[] }>
  } | null
  if (!lib || !Array.isArray(lib.roles) || !lib.roles.length) return false
  if (!Array.isArray(lib.industries) || !lib.industries.length || !lib.discovery) return false

  const roles: RoleDef[] = []
  for (const r of lib.roles) {
    if (!r.id || !r.name || !Array.isArray(r.areas)) return false
    roles.push({
      id: r.id,
      name: r.name,
      blurb: r.blurb ?? '',
      areas: r.areas,
      jd: {
        file: r.jd?.file ?? 'job-description.pdf',
        pages: r.jd?.pages,
        /* Only the kinds the Responsibilities step can act on; the export's other kinds belong to
           Graph Studio's side of the same build. */
        findings: (r.jd?.findings ?? []).filter((f) => FINDING_KINDS.includes(f.kind)),
      },
    })
  }
  ROLES = roles
  INDUSTRIES = lib.industries
  UTILITIES = lib.discovery
  ROLE_DOMAIN_OF = lib.domain_of_role ?? {}
  const reasons = lib.steps?.find((s) => s.key === 'responsibilities')?.out_reasons
  if (reasons?.length) OUT_REASONS = reasons
  return true
}
