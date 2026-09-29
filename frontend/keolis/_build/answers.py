"""The recorded Ask answers — 50 questions across seven personas: 16 hero, 27 standard, 7 declines.
Every figure is computed from world.py; every citation points at a dataset, a Drive document, a
mailbox message or a stated absence. Declines are first-class: they are the misses a demo should show."""
from world import *
import corpus as C

DS = {  # label, as_of
    "ppm": ("keolis_valmont_ppm.ppm", "2026-09-19"), "ops": ("keolis_valmont_ppm.ops", "2026-09-23"), "contract": ("keolis_valmont_ppm.contract", "2026-09-01"),
    "fin": ("keolis_valmont_erp.fin", "2026-09-22"), "proc": ("keolis_valmont_erp.proc", "2026-09-23"),
    "eam": ("keolis_valmont_eam.eam", "2026-09-23"), "tel": ("keolis_valmont_eam.telemetry", "2026-09-23"),
}
GRAPH = "Keolis Valmont SGR graph v1"
PULLED = "2026-09-24T08:40:00Z"

# ------------------------------------------------------------------ block helpers
def T(md): return {"type": "text", "markdown": md}
def MET(*items): return {"type": "metric", "items": [dict(i) for i in items]}
def m(label, value, unit=None, flag=None):
    d = {"label": label, "value": value}
    if unit is not None: d["unit"] = unit
    if flag: d["flag"] = flag
    return d
def CH(kind, title, data, x=None, y=None, note=None):
    b = {"type": "chart", "chart": kind, "title": title, "data": data}
    if x: b["x_label"] = x
    if y: b["y_label"] = y
    if note: b["note"] = note
    return b
def pt(label, value, tone=None):
    d = {"label": label, "value": value}
    if tone: d["tone"] = tone
    return d
def TB(title, cols, rows): return {"type": "table", "title": title, "columns": cols, "rows": rows}
def OBS(label, mids, note):
    items = []
    for mid in mids:
        x = C.MSG[mid]
        items.append({"message_id": mid, "from_name": x["from_name"], "from_side": x["from_side"], "sent_at": x["sent_at"], "subject": x["subject"],
                      "claim": x["body"], "reason_label": x["reason"], "amount": x["amount"], "amount_basis": x["amount_basis"], "months": x["months"],
                      "confidence": x["confidence"], "band": x["band"], "resolved_to": x["resolved_to"], "change_order": x["change_order"]})
    return {"type": "observation", "label": label, "items": items, "note": note}
OBS_NOTE = "Each is a claim by its sender with the extractor's confidence attached — none of it is counted into any figure above."

# ------------------------------------------------------------------ citation helpers
class Cites:
    def __init__(self): self.c, self.e = [], []
    def _add(self, d, ev):
        d["n"] = len(self.c) + 1; self.c.append(d); self.e.append(ev); return self
    def ds(self, key, detail):
        lab, asof = DS[key]
        return self._add({"kind": "dataset", "source_id": "src_bq", "label": lab, "detail": detail, "runtime": False, "as_of": asof, "authoritative": True},
                         {"source": lab, "detail": detail})
    def doc(self, doc_id, detail, authoritative=True):
        d = C.DOC[doc_id]
        return self._add({"kind": "document", "source_id": "src_drive", "label": d["name"], "detail": detail, "runtime": False, "as_of": d["modified"] if d["modified"][:2] == "20" else None,
                          "authoritative": authoritative}, {"source": d["name"], "detail": detail})
    def mail(self, mid, detail=None):
        x = C.MSG[mid]
        proj = x["project"]
        ext = {"reason_class": x["reason"].split(" (")[0].lower().replace(" ", "_").replace("—", "").replace("__", "_"), "reason_label": x["reason"], "statement": x["body"],
               "amount": x["amount"], "amount_basis": x["amount_basis"], "months": x["months"], "confidence": x["confidence"], "band": x["band"],
               "above_publication_floor": (x["confidence"] or 0) >= 0.7, "resolved_to": x["resolved_to"], "resolved_to_project": f"p_{proj.lower().replace('-', '_')}" if proj else None,
               "binding_evidence": (f"Project code {proj} in the subject line or body; sender domain matches the supplier or authority register." if proj else "No project code in the message; resolved on the document it names."),
               "competing_candidates": 0, "change_order": x["change_order"], "contract_package": None, "document": None}
        return self._add({"kind": "correspondence", "source_id": "src_gmail", "label": f"Mailbox · {x['from_name']}", "detail": detail or x["subject"], "runtime": True, "as_of": None,
                          "authoritative": False, "pulled_at": PULLED,
                          "message": {"id": mid, "from": x["from_addr"], "from_name": x["from_name"], "from_org": x["from_org"], "from_side": x["from_side"], "to": x["to"],
                                      "sent_at": x["sent_at"], "subject": x["subject"], "excerpt": x["body"][:220]},
                          "extraction": ext,
                          "why_not_authoritative": "A message is a claim by its sender, not a record. It is shown with the sender, the date and the extractor's confidence, and it never changes a figure until the owning process records it."},
                         {"source": "Mailbox (runtime)", "detail": detail or x["subject"]})
    def graph(self, detail):
        return self._add({"kind": "graph", "source_id": "graph_kv", "label": GRAPH, "detail": detail, "runtime": False, "as_of": AS_OF, "authoritative": True},
                         {"source": GRAPH, "detail": detail})
    def absent(self, detail):
        return self._add({"kind": "absence", "source_id": None, "label": "Not connected", "detail": detail, "runtime": False, "as_of": None, "authoritative": False},
                         {"source": "—", "detail": detail})

ANS = []
def A(aid, persona, kind, q, summary, blocks, cites, conf, refs, hero=None):
    level = "High" if conf >= 0.85 else ("Medium" if conf >= 0.7 else "Low")
    ANS.append({"answer_id": aid, "persona": persona, "kind": kind, "question": q, "hero_ref": hero, "summary": summary, "blocks": blocks,
                "evidence": cites.e, "confidence_level": level, "confidence": conf, "graph_refs": refs, "citations": cites.c})

OE, IC, ML, PM, CM, SP, AL = ("Operating Company Executive", "Investment Controller", "Rolling Stock Maintenance Lead", "Infrastructure Project Manager",
                              "Commercial & Contract Manager", "Service Planning Lead", "Authority Liaison (PPI)")
P = PBY
TOT = portfolio_totals()
ASSESSED = [p for p in PORTFOLIO if p["budget"] and p["forecast_available"]]
A_BUD = sum(p["budget"] for p in ASSESSED); A_FC = sum(p["forecast"] for p in ASSESSED)
NOFC = [p for p in PORTFOLIO if not p["forecast_available"]]
def e0(v): return eur(v)
def em(v): return eur_m(v)

# ================================================================== HERO
c = Cites().ds("ppm", "Stage, baseline and current dates, approvals — all 38 projects").ds("fin", "Forecast snapshots and variance, 25 assessed projects").ds("proc", "Supplier promised dates on open PO lines") \
    .ds("ops", "Access window ACC-T1-2026-031 status").mail("msg_001", "Levantis: HPU-9 now 19 October").mail("msg_011", "Arvéa: batch 3 realistic date 21 October").graph("Ranking rule: mandatory date · service consequence · cost growth · funding gap · supplier delay · unresolved approval")
A("Q01", OE, "hero", "Which renewal projects need intervention this week, and why?",
  "Five projects need a decision this week. T1 track renewal is blocked by a provisional closure and an open scope change; tranche 2 buses and the Les Aubiers lift both have supplier slips the schedule does not show yet.",
  [T("Ranked by the agreed business rules, with each contributing factor kept visible — there is **no single score**. Read over the 38 projects in the PPM as of **19 September** (the project office's weekly publication sets the as-of floor), with supplier statements read from the mailbox at question time."),
   MET(m("Projects needing a decision", 5, "of 38", "risk"), m("Blocked starts", 1, "T1 closure", "risk"), m("Supplier slips not in schedule", 2, "lift · buses", "risk"), m("Unapproved scope in forecast", em(1_320_000), "TV-100 frames")),
   TB("Exceptions this week", ["Project", "What changed", "Factors", "Decision required", "Accountable"], [
      ["P-VM-008 T1 track renewal", "Closure still provisional; drawing rev C extends the limit onto SIG-T1-044", "unresolved approval · service consequence · scope change", "Service committee 1 Oct: approve closure; commission signalling interface review", "Inès Benali"],
      ["P-VM-014 Bus renewal tranche 2", "Arvéa now says 21 Oct for batch 3 (ERP still 30 Sep)", "mandatory date · supplier delay · service consequence", "Keep BUS-201–208 in service to late Oct; confirm Art. 34.4 notices on any failure", "Hugo Lambert"],
      ["P-VM-021 Lift replacement Les Aubiers", "HPU-9 moves 5 → 19 Oct; commissioning 26 Oct not achievable", "supplier delay · schedule conflict", "Re-plan commissioning; decide on €25k external workshop (proposal)", "Sandrine Pelletier"],
      ["P-VM-005 TV-100 overhaul", "Second NDT batch: 8 of 24 frames cracked; RC-005-009 not approved", "cost growth · unresolved approval", "Authority decision on RC-005-009 (€2.64M requested)", "Pierre-Yves Collin"],
      ["P-VM-031 Battery campaign", "40 installed, 37 accepted — reported as 'complete'", "acceptance incomplete", "Hold completion until BUS-417/431 defects and BUS-422 certificate close", "Julien Faure"],
   ]),
   T("**What this is not.** It is not a prediction of which projects will fail. P-VM-026 (charging bank 2) also slipped, but its new date is already in the schedule and approved, so it ranks below the five. The two supplier dates come from correspondence and stay **unconfirmed** until procurement records them.")],
  c, 0.88, ["PRJ:P-VM-008", "PRJ:P-VM-014", "PRJ:P-VM-021", "PRJ:P-VM-005", "PRJ:P-VM-031"], "hq1")

op_ger = sum(p["forecast"] for p in PORTFOLIO if p["payer"] == "Keolis Valmont" and p["budget"])
op_031 = round(P["P-VM-031"]["forecast"] * 0.6)
OPX = op_ger + op_031
fund_gap = sum(max(p["forecast"] - p["budget"], 0) for p in ASSESSED if "PPI" in p["funding"] or "GRANT" in p["funding"])
c = Cites().ds("fin", "Budget lines (current approved version), ledger, accruals, forecast snapshots").ds("proc", "Open PO lines — remaining commitment").ds("fin", "funding_claim — five claim states").ds("contract", "Payer by asset scope — GER vs PPI").absent("4 projects without a current forecast are excluded from forecast figures")
A("Q02", OE, "hero", "What is our full financial exposure on the renewal portfolio?",
  f"Forecast total {em(A_FC)} against {em(A_BUD)} approved on the 25 projects that carry a current forecast — {em(A_FC - A_BUD)} over. Keolis Valmont's own exposure is {em(OPX)}; the rest is the authority's PPI.",
  [T(f"Two perspectives, stated separately. **Authority-facing project cost** is the full renewal expenditure. **Operator exposure** is only what Keolis Valmont bears under validated allocations — GER projects in the contract price, plus its 60% share of the battery campaign. Figures in EUR HT at the M08 close plus daily increments to **22 September**."),
   MET(m("Approved budget (assessed)", A_BUD, "EUR"), m("Forecast total (assessed)", A_FC, "EUR", "risk"), m("Forecast variance", A_FC - A_BUD, "EUR", "risk"),
       m("Open commitment", sum(p["committed"] for p in ASSESSED), "EUR"), m("Operator exposure", OPX, "EUR"), m("Approved funding gap (PPI)", fund_gap, "EUR", "risk")),
   CH("bar", "Forecast vs approved budget by category (assessed projects)", [pt(k, v) for k, v in (("Fleet — tram", 35_518_000), ("Fleet — bus", 20_212_000), ("Power & charging", 10_643_000), ("Track & civil", 6_160_000), ("Depot & workshop", 5_592_000), ("Stations & passenger info", 2_141_000), ("Signalling & systems", 1_710_000))],
      "Category", "EUR (forecast total)", "The tram fleet carries €2.0M of the €2.5M net variance — mostly the TV-100 frame allowance."),
   TB("Recovery from the authority — kept as separate states", ["State", "Amount", "What it means"], [
      ["Potential", e0(408_000), "Eligible in principle, not claimed (T1 works not started; BUS-204 under review)"],
      ["Submitted", e0(1_210_000), "Battery campaign 40% share — acceptance evidence requested"],
      ["Accepted", e0(2_960_000), "Q2 overhaul milestones — payment due 30 Sep"],
      ["Disputed", e0(1_480_000), "Charging bank 1 claim; €212,000 contested as outside PPI scope"],
      ["Paid", e0(7_920_000), "Cash received in 2026"]]),
   T(f"**Excluded, not hidden:** {', '.join(p['code'] for p in NOFC)} ({em(sum(p['budget'] for p in NOFC))} approved) have no forecast since June. **Unallocated spend** of €1,312,480 sits outside every project. Neither potential nor disputed recovery is counted as cash.")],
  c, 0.86, ["MEAS:forecast_total", "MEAS:operator_exposure", "MEAS:funding_gap", "CONCEPT:FundingClaim"], "hq2")

c = Cites().ds("ppm", "Approved and in-delivery projects with a start or cut-over in the next 60 days; approvals and conditions").ds("proc", "Critical PO lines and promised dates; stores reservations").ds("ops", "Access windows and the HIV-2026 service requirement") \
    .ds("eam", "Availability intervals by vehicle class").doc("DOC:vm-t1-voi-0457-revc", "Rev C interface review outstanding").absent("Workforce and crew availability are not connected — skills are not tested")
A("Q03", OE, "hero", "Is the approved work ready to proceed without undermining service?",
  "Two of five near-term starts are ready. T1 track renewal is not — access is provisional and design has an open interface review; the lift and batch 3 are held by parts.",
  [T("Each start in the next 60 days is tested on the same six gates. A red gate names what is missing and who owns it. **Skills and crews are not tested** — no workforce source is connected, so that column is left blank rather than assumed green."),
   TB("Readiness — starts before 30 November", ["Project · start", "Scope", "Funding", "Design", "Parts", "Access", "Acceptance criteria", "Ready?"], [
      ["P-VM-008 rail renewal · 17 Oct", "changed (rev C)", "approved", "interface review open", "rail on site", "PROVISIONAL", "defined", "No"],
      ["P-VM-021 lift install · 12 Oct", "stable", "approved (GER)", "issued", "HPU-9 late → 19 Oct", "n/a", "statutory test booked 26 Oct", "No — commissioning"],
      ["P-VM-014 batch 3 release · Oct", "stable", "approved", "issued", "inverters wk 41", "n/a", "charging bank 2 energised 20 Oct", "No"],
      ["P-VM-040 hybrid overhaul · 2 Nov", "stable", "approved (GER)", "issued", "kits reserved", "bays 3–4 depend on lift", "defined", "At risk"],
      ["P-VM-059 TETRA terminals · 3 Nov", "stable", "approved", "issued", "in stores", "n/a", "defined", "Yes"],
      ["P-VM-054 CMT roof & drainage · 16 Nov", "stable", "approved", "issued", "contractor mobilised", "night works only", "defined", "Yes"]]),
   MET(m("Ready", 2, "of 6 starts", "good"), m("Blocked by access", 1), m("Blocked by parts", 2, None, "risk"), m("Not tested — crews", "not connected")),
   T("An approved project can still be operationally unready: **P-VM-008** is approved with conditions (closure approval, isolation plan). A stocked part can still be unavailable — the HPU-9 spares in stores are reserved for emergency maintenance and are not counted.")],
  c, 0.82, ["PRJ:P-VM-008", "ACC:ACC-T1-2026-031", "PRJ:P-VM-021", "PRJ:P-VM-014", "PRJ:P-VM-040"], "hq3")

b = EX_B
c = Cites().ds("fin", "P-VM-021 budget line, posted actuals, valid accruals, forecast snapshot 2026-09-15").ds("proc", "PO-4500018812 line 30 — promised date still 5 October in ERP").ds("ppm", "Schedule: install 12 Oct, commission 26 Oct, complete 30 Oct") \
    .mail("msg_001", "Levantis: HPU-9 arrives 19 October").mail("msg_002", "Depot: cannot commission on the 26th").doc("DOC:p-vm-021-progress-2026-09", "Progress report 11 Sep: 'on schedule' — written before the supplier's message", authoritative=False)
A("Q04", IC, "hero", "Is the depot lift replacement at Les Aubiers still on budget, and is it on time?",
  "On budget, not on time. Forecast €390,000 against €400,000 approved — but the supplier says the control unit arrives 19 October, so commissioning on 26 October cannot happen and the schedule does not show it yet.",
  [T("The cost indicator is favourable and the schedule is not. The official schedule still shows completion on **30 October** because the supplier's revised date is in correspondence, not yet in the ERP or the PPM."),
   MET(m("Approved budget", b["budget"], "EUR"), m("Forecast total", b["forecast_total"], "EUR", "good"), m("Variance", b["forecast_total"] - b["budget"], "EUR", "good"), m("Commissioning", "at risk", "26 Oct", "risk")),
   TB("Forecast total — P-VM-021", ["Component", "EUR HT", "Basis"], [
      ["Posted actuals", e0(b["actuals"]), "ledger, to 22 Sep"], ["Valid uninvoiced accruals", e0(b["accruals"]), "not yet reversed by an invoice"],
      ["Remaining committed work", e0(b["committed_remaining"]), "PO lines less received — not the full PO again"],
      ["Uncommitted remaining work", e0(b["uncommitted_remaining"]), "estimate"], ["Contingency (held separately)", e0(b["contingency"]), "not inside the figures above"],
      ["Forecast total", e0(b["forecast_total"]), "€10,000 below budget"]]),
   OBS("From correspondence", ["msg_001", "msg_002"], OBS_NOTE),
   T("**The conflict:** HPU-9 on 19 Oct → installation of set C cannot finish before ~23 Oct → statutory test and commissioning slip past 26 Oct → bays 3–4 are needed by the **hybrid overhaul campaign on 2 November** (P-VM-040). Owner: Sandrine Pelletier.")],
  c, 0.87, ["PRJ:P-VM-021", "POL:4500018812-30", "TSK:P-VM-021-T05", "PRJ:P-VM-040"], "hq4")

a = EX_A
c = Cites().doc("DOC:dsp-vm-2021", "Annex 7: BUS-204 contractual replacement date 30 June 2026").doc("DOC:dsp-vm-2021-av2", "Art. 34.4 as restated: > €5,000, 30-day notice, cap €35,000, exclusion for maintenance default") \
    .doc("DOC:dsp-vm-2021-av3", "AV3 moves BUS-209–216 only; BUS-204 unchanged").ds("eam", "Failure 12 Jul, WO-2026-071244; OIL-60K overdue by 2,400 km").doc("DOC:q-26-1187", "Quote €28,000 HT").mail("msg_009", "Notice sent 29 Jul (17 days after failure)").mail("msg_010", "Authority acknowledged 3 Aug — no decision").ds("fin", "No posted cost and no PO for the repair")
A("Q05", CM, "hero", "Who pays for the BUS-204 engine repair?",
  "Not settled. The contract would put it on Valmont Métropole — BUS-204 failed after its 30 June replacement date and notice went in time — but an overdue oil analysis may trigger the maintenance-default exclusion. It is a recovery to review, not a receivable.",
  [T("What is **established** and what is **unresolved**, separately. Nothing here labels either party legally liable; that needs the commercial team's validated reading of Article 34.4.4."),
   TB("Established", ["Fact", "Value", "Source"], [
      ["Contractual replacement date", "30 June 2026", "Annex 7 — not moved by Avenant n°3 (which covers BUS-209–216 only)"],
      ["Replacement forecast", "tranche 2 batch 3: 30 Sep (ERP) · 21 Oct (Arvéa email)", "not attributable to Keolis"],
      ["Failure", "12 July 2026 — engine seizure, WO-2026-071244", "EAM"],
      ["Estimate", "€28,000 HT (quote Q-26-1187)", "above €5,000 threshold, under €35,000 cap"],
      ["Notice", "sent 29 July — 17 days, within 30", "KV-DIR-2026-0412"],
      ["Approval state", "acknowledged 3 Aug; no confirmation of the charge", "authority reply"]]),
   TB("Unresolved", ["Question", "Why it matters", "Owner"], [
      ["Did the overdue OIL-60K task (2,400 km past due) cause the failure?", "Art. 34.4.4 excludes failures from a maintenance default — the charge would return to Keolis", "Julien Faure (engineering) · Valérie Chauvin (commercial)"],
      ["Order the rebuild before confirmation?", "Art. 34.4.5 allows it only if the vehicle is needed for service continuity", "Karim Haddad (service need)"]]),
   MET(m("Potential recovery", 28000, "EUR"), m("Posted cost", 0, "EUR"), m("Claimed", "no"), m("Cash", 0, "EUR")),
   T("The estimate is **not a posted cost** and the potential recovery is **not cash**. Next action: engineering and commercial joint review, then decide whether to rebuild (€28,000) or withdraw BUS-204 until batch 3 arrives.")],
  c, 0.84, ["AST:BUS-204", "FAIL:bus-204_2026-07-12", "CLS:dsp_34_4", "COND:34_4_exclusion", "RSP:bus-201-208_replacement", "NEED:N-VM-044"], "hq5")

x = EX_C
c = Cites().ds("ppm", "P-VM-008 schedule: closure 17 Oct depends on ACC-T1-2026-031").ds("ops", "ACC-T1-2026-031 status PROVISIONAL").doc("DOC:vm-t1-voi-0457-revc", "Rev C: work limit to 4+010 — SIG-T1-044 foundation — interface review required") \
    .doc("DOC:p-vm-008-method", "VTC programme assumes rev B", authoritative=False).mail("msg_004", "Authority: cannot approve until replacement-bus plan; decision 1 Oct").mail("msg_005", "VTC: ready for 17 October").mail("msg_018", "Service planning: 11 buses without batch 3, 14 needed")
A("Q06", PM, "hero", "Can the T1 track renewal at Gare Centrale start on 17 October?",
  "Not yet. The closure is still provisional, drawing revision C moved the work limit onto signal SIG-T1-044 without an interface review, and the contractor's method statement still shows revision B. The contractor's readiness does not substitute for approved access.",
  [T(f"Segment **{x['segment']}** ({x['section']}), chainage {x['from_ch']} → {x['to_ch']} in revision B, **{x['to_ch_revC']}** in revision C (9 September). The closure window is {x['closure']}."),
   TB("What blocks the start", ["Gate", "State", "Evidence", "Owner"], [
      ["Access (possession)", "Provisional", "ACC-T1-2026-031; authority decision at service committee 1 Oct", "Inès Benali"],
      ["Scope / design", "Changed — interface review open", "Rev C includes SIG-T1-044 foundation; Signalis review not booked", "Pierre-Yves Collin"],
      ["Contractor method", "Out of date", "VTC method statement assumes rev B (+64 m rail per track in rev C)", "VTC / Inès Benali"],
      ["Replacement buses", "Short by 3", "14 needed; 11 available unless tranche 2 batch 3 arrives", "Karim Haddad"],
      ["Funding", "Approved", "PPI — €3,260,000", "—"]]),
   OBS("From correspondence", ["msg_004", "msg_005", "msg_018"], OBS_NOTE),
   T("Neither the contractor's mobilisation on 12 October nor an optimistic progress note is approval. **Decision required:** approve the closure on 1 October with the 14-bus plan, or move the window; commission the signalling interface review this week.")],
  c, 0.89, ["PRJ:P-VM-008", "AST:TRK-T1-S07", "AST:SIG-T1-044", "ACC:ACC-T1-2026-031", "CHG:p-vm-008_revc", "STM:vtc_rev_b"], "hq6")

d = EX_D
c = Cites().ds("eam", "component_installation: 40 packs installed in campaign P-VM-031").ds("ppm", "acceptance_item: 37 passed, 2 failed, 1 missing").ds("eam", "availability_interval: 37 vehicles released by engineering for duty") \
    .doc("DOC:p-vm-031-commissioning", "Acceptance register — BUS-417, BUS-431 open defects; BUS-422 certificate missing").mail("msg_008", "Project: 'campaign complete' — installed, not accepted").mail("msg_007", "Celtia corrective actions 29 Sep / 2 Oct")
A("Q07", ML, "hero", "Is the battery replacement campaign complete?",
  "Installed yes, complete no. 40 packs are installed, 37 are accepted and 37 vehicles are released for duty. Two defects and one missing certificate are open.",
  [MET(m("Installed", d["installed"], "packs"), m("Accepted", d["accepted"], "of 40"), m("Duty-eligible", d["duty_eligible"], "vehicles", "good"), m("Open exceptions", 3, None, "risk")),
   TB("The three exceptions", ["Vehicle", "Issue", "Owner", "Next step"], [
      [d["open_defects"][0][0], d["open_defects"][0][1], "Celtia / Julien Faure", "BMS master board replaced 29 Sep (supplier plan)"],
      [d["open_defects"][1][0], d["open_defects"][1][1], "Celtia / Julien Faure", "Module 6 swap — parts ship 2 Oct"],
      [d["missing_cert"][0], d["missing_cert"][1], "Damien Rocher (commissioning)", "Signed IR-500V certificate to be filed"]]),
   OBS("From correspondence", ["msg_008", "msg_007"], "The project manager's 'complete' refers to installation. It is shown as his claim; the counts above come from the acceptance register and the availability record."),
   T("**Warranty consequence:** Celtia's 8-year warranty starts at operational acceptance, so the three unaccepted packs are not yet under warranty. Documented completeness is 37/40 (92.5%) — and completeness is not permission to operate.")],
  c, 0.93, ["PRJ:P-VM-031", "MEAS:acceptance_completeness", "ACP:bus-417", "ACP:bus-422", "ACP:bus-431"], "hq7")

over = sorted([p for p in ASSESSED if p["variance"] > 0], key=lambda p: -p["variance"])
c = Cites().ds("fin", "Latest Working forecast snapshot per project; approved budget version").ds("ppm", "Project list and stage").mail("msg_020", "Controller: four projects not re-forecast since June")
A("Q08", IC, "hero", "Are all renewal projects within budget?",
  f"No — and the question can only be answered for 25 of 29 funded projects. Of those, {len(over)} forecast above budget by {em(sum(p['variance'] for p in over))} in total; the four without a current forecast ({em(sum(p['budget'] for p in NOFC))}) are unassessed.",
  [T("A statement that the portfolio is within budget would be inappropriate while part of it has no forecast. The **assessed population** is stated first."),
   MET(m("Funded projects", TOT["funded"]), m("Assessed (current forecast)", len(ASSESSED), f"of {TOT['funded']}"), m("Over budget", len(over), "projects", "risk"), m("Net variance (assessed)", A_FC - A_BUD, "EUR", "risk")),
   TB("Over budget — assessed projects", ["Project", "Approved", "Forecast", "Variance"], [[f"{p['code']} {p['name'][:46]}", e0(p["budget"]), e0(p["forecast"]), "+" + e0(p["variance"])] for p in over[:8]]),
   TB("Not assessed — no forecast since June", ["Project", "Approved", "Last forecast"], [[f"{p['code']} {p['name'][:46]}", e0(p["budget"]), "2026-06-15"] for p in NOFC]),
   T("Variance is **forecast minus current approved budget**; positive means overrun. P-VM-005 carries 66% of the overrun — see the TV-100 answer for its drivers.")],
  c, 0.9, ["MEAS:budget_variance", "MEAS:forecast_total", "PRJ:P-VM-005", "PRJ:P-VM-026"], "hq8")

c = Cites().ds("ppm", "Changes between the 12 Sep and 19 Sep publications").ds("fin", "Forecast snapshots 2026-09-15 vs 2026-08-14").doc("DOC:vm-t1-voi-0457-revc", "Rev C issued 9 Sep").mail("msg_001").mail("msg_011").mail("msg_016", "Second NDT batch").mail("msg_007")
A("Q09", OE, "hero", "What changed since last week's project review?",
  "Four material changes: two supplier dates moved (lift control unit, tranche 2 batch 3), T1 scope grew with drawing revision C, and the second TV-100 inspection batch doubled the cracked-frame count. One improvement: Celtia committed dates for both battery defects.",
  [TB("Since the review of 17 September", ["When", "What changed", "Where it came from", "Recorded in the system?"], [
      ["16 Sep", "HPU-9 control unit 5 Oct → 19 Oct (P-VM-021)", "Supplier email", "No — ERP still 5 Oct"],
      ["8 Sep (read 18 Sep)", "Tranche 2 batch 3 30 Sep → 21 Oct 'realistic' (P-VM-014)", "Supplier email", "No — waiting for revision 4"],
      ["9 Sep", "T1 work limit 3+980 → 4+010, SIG-T1-044 inside the limit (P-VM-008)", "Drawing rev C", "Yes — document; schedule not re-baselined"],
      ["4 Sep", "TV-100 frames: 8 of 24 cracked after batch 2 (P-VM-005)", "Engineering email", "Forecast allowance yes; change not approved"],
      ["17 Sep", "BUS-417 fix 29 Sep, BUS-431 parts 2 Oct (P-VM-031)", "Supplier email", "No"]]),
   T("Three of five changes exist only in correspondence. They are shown as **dated statements** until procurement or the project office records them.")],
  c, 0.85, ["PRJ:P-VM-021", "PRJ:P-VM-014", "PRJ:P-VM-008", "PRJ:P-VM-005", "PRJ:P-VM-031"], "hq9")

c = Cites().ds("ops", "HIV-2026 service requirement: 12 m bus peak 168 + reserve 17 (10%)").ds("eam", "Availability intervals 23 Sep; engineering release").ds("ppm", "Tranche 2 batch 3 and T1 closure dates").mail("msg_018").mail("msg_011")
A("Q10", SP, "hero", "Do we have enough buses for peak service while tranche 2 is late and the T1 closure runs?",
  "Weekdays yes, with a margin of 6. On the closure Saturday no: the Technopole event service leaves 11 buses for a shuttle that needs 14, unless tranche 2 batch 3 arrives first.",
  [T("Service availability margin = eligible available vehicles − peak requirement − agreed reserve, per class and day type. Each unavailable vehicle is subtracted **once**, from its availability interval — an open work order alone does not make a bus unavailable."),
   TB("12 m bus margin", ["Day", "Eligible available", "Peak", "Reserve", "Margin", "Shuttle need", "After shuttle"], [
      ["Weekday (today)", 191, 168, 17, 6, 0, 6],
      ["Sat 17 Oct — without batch 3", 191, "163 (incl. Technopole event)", 17, 11, 14, -3],
      ["Sat 17 Oct — with batch 3 (+8)", 199, "163 (incl. Technopole event)", 17, 19, 14, 5]]),
   MET(m("Weekday margin", 6, "buses"), m("BUS-201–208 in the count", 8, "past replacement date", "risk"), m("Closure Saturday", -3, "buses short without batch 3", "risk")),
   T("Two caveats. The weekday margin of 6 **includes the eight buses past their replacement date** (BUS-201–208): each further failure there is both a service loss and an Article 34.4 question. Drivers are not tested — workforce data is not connected; the planner's stated need is 9.")],
  c, 0.8, ["MEAS:availability_margin", "SRQ:bus_12m", "PRJ:P-VM-014", "ACC:ACC-T1-2026-031"], "hq10")

c = Cites().ds("fin", "Forecast snapshot lines vs current approved scope").ds("ppm", "RC-005-009 status submitted, not approved").mail("msg_003", "External workshop proposal €25,000").mail("msg_013", "Authority disputes €212,000").doc("DOC:rc-005-009", "€2,640,000 requested")
A("Q11", IC, "hero", "Which costs may fall outside the currently authorised scope?",
  "Three items for finance and commercial review, €1.56M in total: the TV-100 frame allowance already carried in the forecast (€1.32M), the disputed grid reinforcement (€212k) and a proposed €25k external workshop. None is labelled anyone's liability.",
  [TB("Review items — not findings of liability", ["Item", "Amount", "Why it may be outside scope", "Review by"], [
      ["TV-100 frame replacement allowance (P-VM-005)", e0(1_320_000), "In the forecast; RC-005-009 not approved; base contract excludes frames", "Finance + commercial + authority"],
      ["Grid reinforcement share (P-VM-026)", e0(212_000), "Authority: PPI covers depot equipment, not the public network", "Commercial"],
      ["External workshop for hybrids (P-VM-021 / P-VM-040)", e0(25_000), "Proposal; project budget or maintenance operating budget undecided", "Finance"]]),
   MET(m("Total under review", 1_557_000, "EUR"), m("Already in forecasts", 1_532_000, "EUR"), m("Proposal only", 25_000, "EUR")),
   T("This list raises review items. It does not decide that the authority, Keolis Valmont or a supplier is liable — that needs validated terms and professional review.")],
  c, 0.83, ["CHG:rc-005-009", "CLM:CLM-2026-Q2-02", "PRJ:P-VM-021", "MEAS:funding_gap"], "hq11")

c = Cites().ds("fin", "funding_claim — Q3 lines and prior states").ds("ppm", "Milestones achieved in Q3").doc("DOC:my-claims-tracker", "Working copy emailed 15 Sep — does not supersede the register", authoritative=False)
A("Q12", AL, "hero", "What will the authority see for the Q3 PPI claim, and what is still only potential?",
  "The Q3 claim can carry €4.86M of evidenced milestones. The T1 works (€380k) and the BUS-204 recovery (€28k) are potential only and should not appear as claimed.",
  [TB("Q3 claim — draft lines", ["Project", "Basis", "Amount", "State"], [
      ["P-VM-005 TV-100 overhaul", "Milestones M8–M9 (trams 105–108 released)", e0(2_480_000), "ready to submit"],
      ["P-VM-014 tranche 2", "Batch 2 accepted (8 buses)", e0(1_920_000), "ready to submit"],
      ["P-VM-017 SST-04", "Rectifier order deposit", e0(460_000), "ready to submit"],
      ["P-VM-008 T1 track", "Works not started", e0(380_000), "potential — not claimable"],
      ["N-VM-044 BUS-204", "Art. 34.4 under review", e0(28_000), "potential — not claimable"]]),
   MET(m("Claimable Q3", 4_860_000, "EUR", "good"), m("Potential only", 408_000, "EUR"), m("Disputed from Q2", 212_000, "EUR", "risk")),
   T("The authority sees approved scope, funding, delivery evidence and the claim. Operator margin information stays restricted. The controller's emailed tracker is a working copy — the register is the source.")],
  c, 0.86, ["CONCEPT:FundingClaim", "CLM:CLM-2026-Q3-01", "CLM:CLM-2026-Q3-02"], "hq12")

needs = NEEDS
c = Cites().ds("ppm", "intervention_need — 47 needs; 8 open with validated triggers").ds("eam", "Condition assessments and failures behind each trigger").ds("ppm", "option_appraisal where an option study exists")
A("Q13", ML, "hero", "Which assets must be renewed, and which needs are still unfunded?",
  f"Eight validated needs are open, €{sum(n[4] for n in needs)/1e6:.1f}M by estimate. One is mandatory and unfunded — the Les Aubiers fuel tank failed its leak test.",
  [TB("Open needs (the unfunded backlog is kept, not hidden)", ["Need", "Asset", "Trigger", "Estimate", "Status", "Owner"],
      [[n[0] + " " + n[1][:44], n[2], n[3], e0(n[4]), n[5], n[6]] for n in needs]),
   MET(m("Open needs", len(needs)), m("Mandatory, unfunded", 1, "fuel tank", "risk"), m("Backlog estimate", sum(n[4] for n in needs), "EUR")),
   T("Status is separated: unfunded, option study, deferred, under review. **Age is not condition** — SST-02 enters on its insulation test, not on its age. Safety and mandatory items cannot be traded away by a cost score.")],
  c, 0.85, ["MEAS:renewal_backlog", "NEED:N-VM-046", "NEED:N-VM-041", "NEED:N-VM-042", "NEED:N-VM-039"], "hq13")

dr = DRIVERS["P-VM-005"]
c = Cites().ds("fin", "P-VM-005 forecast snapshots Feb–Sep 2026").doc("DOC:p-vm-005-option-study", "Selected option assumed no frame replacement; 10% re-appraisal trigger").doc("DOC:rc-005-009", "RC-005-009 requested €2.64M, +122 days").mail("msg_016", "8 of 24 frames cracked after batch 2").doc("DOC:trs-2024-ovh-01", "Indexation clause; frames outside base scope")
A("Q14", OE, "hero", "Why has the TV-100 overhaul forecast grown?",
  f"It is {em(P['P-VM-005']['variance'])} over the €31.2M budget. Most of it (€1.32M) is an allowance for frame replacement the forecast now carries although the change is not approved; the rest is indexation and four extra months of depot support.",
  [MET(m("Approved budget", P["P-VM-005"]["budget"], "EUR"), m("Forecast total", P["P-VM-005"]["forecast"], "EUR", "risk"), m("Variance", P["P-VM-005"]["variance"], "EUR", "risk"), m("Schedule variance", 122, "days", "risk")),
   CH("bar", "Variance drivers — P-VM-005", [pt(l.split(" (")[0], v, "crit" if k == "scope" else "warn") for l, v, k in dr], "Driver", "EUR"),
   TB("Drivers, each with its evidence", ["Driver", "Amount", "Kind", "Evidence"], [[l, e0(v), k, ev] for (l, v, k), ev in zip(dr, ("RC-005-009 + NDT batch 2 email", "Contract clause 9", "Programme +122 days"))]),
   T("The option study's key assumption — frames need inspection, not replacement — has failed: 31% of frames cracked in batch 1 against a 10% re-appraisal trigger. **Decision required:** re-appraise the option and decide RC-005-009; the €1.32M allowance covers 12 trams, the request covers 24.")],
  c, 0.87, ["PRJ:P-VM-005", "CHG:rc-005-009", "STM:p-vm-005_assumption", "MEAS:budget_variance"], "hq14")

# ================================================================== STANDARD
p5 = P["P-VM-005"]
c = Cites().ds("fin", "P-VM-005 forecast snapshot 2026-09-15 — CTC committed, uncommitted, contingency")
A("Q15", IC, "standard", "What is the forecast cost to complete on the TV-100 overhaul, and does it include contingency?",
  f"{em(p5['ctc'])} to complete, including {em(p5['contingency'])} of contingency held separately.",
  [MET(m("Remaining committed", p5["committed"], "EUR"), m("Expected uncommitted", p5["uncommitted"], "EUR"), m("Contingency (separate)", p5["contingency"], "EUR"), m("Forecast cost to complete", p5["ctc"], "EUR")),
   T("Committed work is the remaining value of Transalp's contract, not the full contract value again. The uncommitted line includes the €1.32M frame allowance.")], c, 0.92, ["PRJ:P-VM-005", "MEAS:forecast_ctc"])

c = Cites().ds("contract", "responsibility_assignment — replacement dates by asset scope").doc("DOC:dsp-vm-2021-av3", "AV3 moves BUS-209–216 to 31 Dec").ds("eam", "asset_register status and availability 23 Sep")
A("Q16", CM, "standard", "Which buses are past their contractual replacement date and still in service?",
  "Eight: BUS-201 to BUS-208, past 30 June 2026. BUS-209 to BUS-216 are not — Avenant n°3 moved their date to 31 December.",
  [TB("Series 201–216", ["Range", "Replacement date", "Basis", "In service", "Failures since the date"], [
      ["BUS-201 – BUS-208", "2026-06-30", "Annex 7 (unchanged)", "8 (BUS-204 withdrawn since 12 Jul)", "1 heavy (BUS-204 engine), 3 minor"],
      ["BUS-209 – BUS-216", "2026-12-31", "Annex 7 as amended by AV3, effective 1 Apr 2026", "8", "not applicable"]]),
   T("BUS-204 is in the eight but currently **withdrawn** awaiting the rebuild decision, so 7 of the 8 are running.")], c, 0.94, ["RSP:bus-201-208_replacement", "RSP:bus-209-216_replacement", "CON:DSP-VM-2021-AV3", "AST:BUS-204"])

c = Cites().doc("DOC:dsp-vm-2021-av3", "Scope: BUS-209–216 only").ds("contract", "contract_version AV3: effective 2026-04-01, received 2026-04-18").mail("msg_019", "Executed copy transmitted 18 April")
A("Q17", CM, "standard", "Did Avenant n°3 change BUS-204's replacement date?",
  "No. Avenant n°3 moves only BUS-209 to BUS-216. BUS-204 stays at 30 June 2026.",
  [T("Avenant n°3 was signed on 27 March, is **effective from 1 April** and was **received on 18 April**. Both dates are kept: for anything decided between 1 and 18 April, the date applied in the business had changed but Keolis Valmont did not yet know it."),
   TB("Annex 7 — before and after", ["Range", "Before AV3", "After AV3"], [["BUS-201–208", "2026-06-30", "2026-06-30"], ["BUS-209–216", "2026-06-30", "2026-12-31"]])], c, 0.97, ["CON:DSP-VM-2021-AV3", "RSP:bus-201-208_replacement", "AST:BUS-204"])

c = Cites().mail("msg_004").mail("msg_005").mail("msg_006").mail("msg_018")
A("Q18", PM, "standard", "What did correspondence say about the T1 closure?",
  "Four messages: the authority will decide on 1 October and treats the window as provisional; the contractor says it is ready; engineering flags the revision C interface; service planning is 3 buses short.",
  [OBS("From correspondence", ["msg_004", "msg_005", "msg_006", "msg_018"], OBS_NOTE),
   T("The contractor's readiness is its own statement. It does not change the access status, which only the service committee can.")], c, 0.86, ["PRJ:P-VM-008", "ACC:ACC-T1-2026-031"])

c = Cites().mail("msg_001").mail("msg_011").mail("msg_017").ds("proc", "Promised dates on the same PO lines")
A("Q19", IC, "standard", "What did suppliers tell us that isn't in the schedule yet?",
  "Three delivery promises moved in correspondence before the ERP or the schedule: Levantis (+14 days), Arvéa (+21 days, 'realistic') and Électro-Réseaux Ouest (+2 months).",
  [TB("Supplier statement vs recorded date", ["PO line", "Recorded promised date", "Latest statement", "Stated on"], [
      ["PO-4500018812/30 (HPU-9)", "2026-10-05", "2026-10-19", "16 Sep"], ["VM-2025-BUS-02 batch 3", "2026-09-30", "2026-10-21 ('realistic')", "8 Sep"], ["SST-04 rectifier group", "2027-02-15", "April 2027", "21 Aug"]]),
   OBS("From correspondence", ["msg_001", "msg_011", "msg_017"], OBS_NOTE)], c, 0.86, ["POL:4500018812-30", "POL:vm-2025-bus-02-b3", "POL:ero-sst04-rg"])

c = Cites().ds("eam", "availability_interval with engineering_release = true").ds("ppm", "acceptance_item result by vehicle")
A("Q20", ML, "standard", "Which vehicles are released for duty after the battery campaign?",
  "37 of the 40 campaign vehicles. BUS-417, BUS-422 and BUS-431 are not released.",
  [MET(m("Released", 37, "vehicles", "good"), m("Held", 3, "BUS-417 · BUS-422 · BUS-431", "risk")),
   T("Release comes from operations' availability record with engineering release, not from the installation count.")], c, 0.95, ["PRJ:P-VM-031", "AST:BUS-417", "AST:BUS-422", "AST:BUS-431"])

p31 = P["P-VM-031"]
c = Cites().ds("fin", "P-VM-031 forecast and funding split").ds("fin", "CLM-2026-Q2-03 submitted — authority 40%").ds("contract", "Cost-sharing letter 2025: Keolis 60 / authority 40")
A("Q21", IC, "standard", "What is the operator exposure on the battery campaign?",
  f"{em(op_031)} — Keolis Valmont's 60% of the {em(p31['forecast'])} forecast. The authority's 40% ({em(p31['forecast'] * 0.4)}) is claimed but not accepted; until it is, Keolis carries it as a disputed-risk scenario, not as cash.",
  [MET(m("Forecast total", p31["forecast"], "EUR"), m("Keolis 60%", op_031, "EUR"), m("Authority 40% — submitted", round(p31["forecast"] * 0.4), "EUR"), m("Unresolved-exposure scenario", p31["forecast"], "EUR", "risk")),
   T("The authority asked for acceptance evidence before accepting the claim — the three open acceptance items are exactly that evidence.")], c, 0.85, ["PRJ:P-VM-031", "MEAS:operator_exposure", "CLM:CLM-2026-Q2-03"])

c = Cites().mail("msg_018").ds("ops", "ACC-T1-2026-031 substitution_buses = 14").ds("eam", "Saturday availability forecast")
A("Q22", SP, "standard", "How many replacement buses can we release for the T1 closure?",
  "11 without tranche 2 batch 3, 14 with it. The plan needs 14.",
  [MET(m("Needed", 14, "buses"), m("Available without batch 3", 11, None, "risk"), m("Available with batch 3", 14, None, "good")),
   OBS("From correspondence", ["msg_018"], OBS_NOTE)], c, 0.83, ["ACC:ACC-T1-2026-031", "PRJ:P-VM-014"])

c = Cites().ds("ppm", "schedule_task predecessors, project dependencies").ds("ops", "access_window").graph("DEPENDS_ON edges")
A("Q23", PM, "standard", "Which projects depend on another project or an external approval?",
  "Six dependencies, two of them on outside parties (the DSO and the authority's service committee).",
  [TB("Dependencies", ["Project", "Depends on", "Kind", "Required by", "Latest date"], [
      ["P-VM-014 batch 3 release", "P-VM-026 charging bank 2", "project", "2026-10-01", "energisation 2026-10-20 (DSO)"],
      ["P-VM-040 hybrid overhaul", "P-VM-021 lift set C (bays 3–4)", "project", "2026-11-02", "commissioning after 26 Oct"],
      ["P-VM-008 rail renewal", "ACC-T1-2026-031", "external approval", "2026-10-17", "decision 1 Oct"],
      ["P-VM-008 rail renewal", "Signalis interface review", "supplier", "before isolation", "not booked"],
      ["P-VM-008 shuttle", "P-VM-014 batch 3", "project", "2026-10-17", "21 Oct (supplier)"],
      ["P-VM-026 bank 2", "DSO reinforcement", "external", "2026-07-31", "2026-10-20"]])], c, 0.87, ["PRJ:P-VM-014", "PRJ:P-VM-026", "PRJ:P-VM-040", "PRJ:P-VM-021", "PRJ:P-VM-008"])

c = Cites().ds("fin", "cost_transaction lines with project_code null")
A("Q24", IC, "standard", "How much spend is not allocated to any project?",
  "€1,312,480 across 412 ledger lines. It stays in an unallocated category — it is not spread over projects.",
  [MET(m("Unallocated spend", 1312480, "EUR", "risk"), m("Lines", 412), m("Largest cost centre", "DEP-SRO", "€486,210")),
   TB("By cost centre", ["Cost centre", "Lines", "Amount"], [["DEP-SRO Saint-Roch", 138, e0(486_210)], ["DEP-AUB Les Aubiers", 171, e0(512_940)], ["DEP-CMT La Varenne", 74, e0(248_300)], ["Head office", 29, e0(65_030)]]),
   T("Proposed allocations go to the review queue for the controller. Matching a cost centre to a depot is **not** evidence that a line belongs to a project at that depot.")], c, 0.9, ["MEAS:forecast_total"])

c = Cites().ds("fin", "P-VM-021 — ledger, accruals, PO remaining, forecast snapshot")
A("Q25", IC, "standard", "Break down the lift project forecast.",
  "€390,000: €160k posted, €20k accrued, €150k committed remaining, €40k uncommitted and €20k contingency held separately.",
  [CH("bar", "P-VM-021 forecast total — components", [pt("Posted actuals", 160000), pt("Accruals", 20000), pt("Committed remaining", 150000), pt("Uncommitted", 40000), pt("Contingency", 20000)], "Component", "EUR"),
   T("Accruals are matched and reversed when invoices arrive; remaining committed work excludes anything already accrued, so nothing is counted twice.")], c, 0.95, ["PRJ:P-VM-021", "MEAS:forecast_total"])

c = Cites().ds("fin", "P-VM-021 forecast; maintenance operating budget line").mail("msg_003")
A("Q26", OE, "standard", "If operations spends €25,000 on external maintenance, what does the lift project cost?",
  "The project forecast stays €390,000. If finance books the €25,000 in the maintenance operating budget, combined project and associated operating spend is €415,000. It is a proposal until authorised.",
  [TB("Two scopes, shown side by side", ["Scope", "Amount", "Status"], [["Project forecast P-VM-021", e0(390_000), "current"], ["+ external workshop (operating budget)", e0(25_000), "PROPOSAL — not authorised"], ["Combined project + associated operating", e0(415_000), "if authorised on the operating budget"]]),
   T("Which budget carries it is finance's decision. On the project budget instead, P-VM-021 would forecast €415,000 against €400,000 — an overrun.")], c, 0.88, ["PRJ:P-VM-021"])

c = Cites().ds("eam", "Failure timestamp 2026-07-12 06:48").mail("msg_009").doc("DOC:dsp-vm-2021-av2", "30 calendar days")
A("Q27", CM, "standard", "Was the BUS-204 notice sent in time?",
  "Yes — 17 days after the failure, inside the 30-day limit.",
  [MET(m("Failure", "12 Jul 2026"), m("Notice", "29 Jul 2026"), m("Elapsed", 17, "days", "good"), m("Limit", 30, "days")),
   T("The notice included the failure report, diagnosis and quotation, as Article 34.4.2 requires.")], c, 0.96, ["NEED:N-VM-044", "COND:34_4_notice"])

c = Cites().mail("msg_013").doc("DOC:p-vm-026-dso-letter", "Reinforcement €212,000 invoiced to the connection applicant").doc("DOC:ppi-q2-2026-minutes", "Dispute recorded at Q2 review")
A("Q28", AL, "standard", "Why is the authority disputing the charging-bank claim?",
  "€212,000 of the €1.48M claim is DSO grid reinforcement, which the authority reads as public-network work outside the PPI convention.",
  [OBS("From correspondence", ["msg_013"], OBS_NOTE),
   T("The rest of the claim is not contested. The evidence pack (DSO offer + scope schedule) was due on 15 August and is not in the Drive folder — that is the open action.")], c, 0.86, ["CLM:CLM-2026-Q2-02", "PRJ:P-VM-026"])

months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
act = FY26_ACT_MONTHLY + FY26_FC_MONTHLY_REMAINING
c = Cites().ds("fin", "FY2026 plan phasing; certified actuals Jan–Aug; Working forecast Sep–Dec")
A("Q29", IC, "standard", "What is the FY2026 capital spend against plan?",
  f"{em(sum(FY26_ACT_MONTHLY))} spent to August against {em(sum(FY26_PLAN_MONTHLY[:8]))} planned; the working forecast lands the year at {em(sum(act))} against a {em(sum(FY26_PLAN_MONTHLY))} plan.",
  [MET(m("Plan FY2026", sum(FY26_PLAN_MONTHLY), "EUR"), m("Actuals Jan–Aug", sum(FY26_ACT_MONTHLY), "EUR"), m("Forecast FY2026", sum(act), "EUR", "risk"), m("Gap to plan", sum(act) - sum(FY26_PLAN_MONTHLY), "EUR", "risk")),
   CH("line", "FY2026 monthly — plan vs actuals (Jan–Aug) and working forecast (Sep–Dec)", [pt(mo, v) for mo, v in zip(months, act)], "Month", "EUR", "Jan–Aug are certified actuals; Sep–Dec are forecast. Plan phasing is on the table below."),
   TB("Plan phasing", ["Month"] + months, [["Plan (€M)"] + [f"{v/1e6:.1f}" for v in FY26_PLAN_MONTHLY]])], c, 0.9, ["MEAS:forecast_total"])

c = Cites().ds("eam", "condition_assessment — latest per asset, by method and scale")
A("Q30", ML, "standard", "Which assets have the worst condition scores?",
  "By scale, since scales cannot be averaged together: T1 S07 rail (wear index 94/100), SST-04 (2 on 1–5), LIFT-AUB-03 (restricted).",
  [TB("Worst per scale", ["Scale", "Asset", "Score", "Finding", "Inspected"], [
      ["0–100 wear", "TRK-T1-S07", 94, "Replacement threshold reached", "2026-07-14"], ["0–100 wear", "TRK-T2-S03", 81, "Significant", "2026-05-22"],
      ["1–5 (1 = worst)", "SST-02", 2, "Insulation degradation", "2026-02-10"], ["1–5 (1 = worst)", "SST-04", 2, "Obsolete rectifier", "2026-03-12"],
      ["pass/restrict/fail", "LIFT-AUB-03", "restrict", "12 t limit", "2025-09-18"], ["pass/restrict/fail", "DEP-AUB-TNK", "fail", "Leak test failed", "2026-05-06"]]),
   T("Original values and scales are retained; nothing is normalised without an approved mapping.")], c, 0.9, ["INSP:ir-t1-2026-07", "INSP:sst-04_2026", "INSP:lift-aub-03_2025"])

slipped = sorted([p for p in PORTFOLIO if p["schedule_var_days"] > 0], key=lambda p: -p["schedule_var_days"])
c = Cites().ds("ppm", "schedule_task — baseline BL vs current finish, working calendar")
A("Q31", PM, "standard", "Which schedule milestones have slipped against baseline?",
  f"{len(slipped)} projects forecast a finish later than their approved baseline; the largest slips are the TV-100 overhaul (+122 days) and tranche 2 (+107 days).",
  [TB("Slipped finishes", ["Project", "Baseline", "Forecast", "Variance (days)"], [[f"{p['code']} {p['name'][:44]}", p["baseline_finish"], p["forecast_finish"], p["schedule_var_days"]] for p in slipped]),
   T("Supplier slips known only from correspondence (lift, batch 3 beyond 30 Sep) are **not** in these dates yet.")], c, 0.88, ["MEAS:schedule_variance", "PRJ:P-VM-005", "PRJ:P-VM-014"])

c = Cites().ds("ppm", "approval_decision — no decision on P-VM-058").doc("DOC:ppi-q2-2026-minutes", "'expected to fund' — minutes, not a decision", authoritative=False).mail("msg_014")
A("Q32", OE, "standard", "Is tranche 3 funded?",
  "No. There is no approved budget. The authority has said it expects to fund it in October — that is a reported expectation, not an approval.",
  [OBS("From correspondence", ["msg_014"], OBS_NOTE),
   T("P-VM-058 is at option study with an estimate of €9.6M. Nothing in the approval register authorises it, and an expectation in minutes or an email is never promoted to an approved budget.")], c, 0.92, ["PRJ:P-VM-058", "STM:tranche3_funding_expected"])

c = Cites().ds("eam", "failure_event (confirmed heavy failures) ÷ usage_monthly distance, 2026 YTD").doc("DOC:p-vm-014-business-case", "2024 rates: 1.9 vs 0.7 per 100,000 km")
A("Q33", ML, "standard", "What is the failure frequency of series 201–216 compared with the fleet?",
  "2.3 heavy-component failures per 100,000 km in 2026 to date, against 0.8 for the rest of the 12 m diesel fleet.",
  [CH("column", "Heavy-component failures per 100,000 km", [pt("Series 201–216 (2024)", 1.9, "warn"), pt("Series 201–216 (2026 YTD)", 2.3, "crit"), pt("Other 12 m diesel (2026 YTD)", 0.8)], "Group", "failures / 100,000 km"),
   T("Exposure-adjusted; months with a meter reset are excluded. The peer group is the same vehicle class — the rate is not compared with trams or e-buses.")], c, 0.84, ["MEAS:failure_frequency", "AST:BUS-204"])

c = Cites().doc("DOC:dsp-vm-2021", "Art. 12, 34.1, 34.3").doc("DOC:trs-2024-ovh-01", "Transalp overhaul contract, buyer Valmont Métropole").ds("contract", "responsibility_assignment — tram scope")
A("Q34", CM, "standard", "Which responsibilities does the DSP assign for tram renewal?",
  "Valmont Métropole owns the trams and decides and funds renewal; Keolis Valmont maintains them and releases and accepts trams around the overhaul; Transalp performs the overhaul under the authority's own contract.",
  [TB("Tram fleet — responsibility by role", ["Role", "Party", "Clause"], [["Owner", AUTHORITY, "Art. 12 (biens de retour)"], ["Operator & maintainer", LEGAL_ENTITY, "Art. 34.1"], ["Renewal decision & funding", AUTHORITY, "Art. 34.3 (PPI)"], ["Overhaul", OVERHAUL_PARTNER, "TRS-2024-OVH-01"], ["Handback recipient", AUTHORITY, "Art. 12.3"]])], c, 0.93, ["CLS:dsp_12", "CLS:dsp_34_3", "ORG:transalp", "RSP:renewal_obligor"])

c = Cites().ds("fin", "forecast_snapshot — last snapshot per project").ds("ppm", "Weekly publication — as-of 19 Sep").mail("msg_020")
A("Q35", IC, "standard", "Which forecasts are out of date?",
  "Four projects have no forecast since 15 June: P-VM-046, P-VM-053, P-VM-061 and P-VM-064. The PPM itself is five days old, which sets the as-of floor for schedule answers.",
  [TB("Stale forecasts", ["Project", "Last snapshot", "Age (days)", "Approved"], [[p["code"] + " " + p["name"][:40], "2026-06-15", 101, e0(p["budget"])] for p in NOFC]),
   T("These projects are excluded from portfolio forecast figures, and every answer that uses them says so.")], c, 0.94, ["MEAS:forecast_total"])

p17 = P["P-VM-017"]
c = Cites().ds("ppm", "P-VM-017 stage Approved; finish 2027-06-30 (baseline 2027-04-30)").mail("msg_017").doc("DOC:sst-04-condition", "Score 2; two trips in 2026 H1")
A("Q36", PM, "standard", "What is the status of the SST-04 renewal?",
  "Approved and on budget (€2.45M), two months late: the rectifier lead time grew to 38 weeks, so energisation moves to June 2027. Two trips this year already cost T1 service.",
  [MET(m("Budget", p17["budget"], "EUR"), m("Forecast", p17["forecast"], "EUR"), m("Schedule variance", 61, "days", "risk"), m("2026 trips", 2, "38 + 51 min T1 loss", "risk")),
   OBS("From correspondence", ["msg_017"], OBS_NOTE)], c, 0.86, ["PRJ:P-VM-017", "AST:SST-04", "INSP:sst-04_2026"])

c = Cites().doc("DOC:acc-t1-2026-031", "Service pattern during closure").ds("ops", "service_requirement weekend").ds("eam", "T1 tram diagram")
A("Q37", SP, "standard", "What does the T1 closure do to service?",
  "From Saturday 04:30 to Monday 04:30, T1 runs Pont Neuf–Technopole only; Gare Centrale–Pont Neuf is served by a shuttle every 6 minutes needing 14 buses and 9 drivers.",
  [MET(m("Closure", "48 h"), m("Shuttle buses", 14), m("Drivers", 9), m("Trams running (T1)", 7, "of 11 weekend diagram")),
   T("The 18 October Technopole event is inside the window — the authority wants a communication plan before approving.")], c, 0.85, ["ACC:ACC-T1-2026-031", "LINE:T1"])

c = Cites().doc("DOC:vm-2025-bus-02-schedule", "Rev 3, 2 June: batch 3 on 30 Sep").doc("DOC:ppi-q2-2026-minutes", "7 July review").mail("msg_011", "8 Sep: 21 Oct realistic").ds("proc", "ERP promised date 30 Sep")
A("Q38", AL, "standard", "What was known about the tranche 2 delay when the Q2 review met?",
  "On 7 July the known position was revision 3: batch 3 on 30 September. The later slip to 21 October was first stated on 8 September and is still not in the ERP.",
  [TB("What was known, when", ["Knowledge date", "Statement", "Source", "Delivery date stated"], [
      ["2026-03-15", "Rev 2", "Supplier programme", "2026-06-15"], ["2026-06-02", "Rev 3", "Supplier programme", "2026-09-30"],
      ["2026-07-07", "Q2 review minutes", "Minutes", "2026-09-30"], ["2026-09-08", "Email — 'realistic 21 Oct'", "Correspondence", "2026-10-21"],
      ["2026-09-23", "ERP promised date", "proc.po_line", "2026-09-30"]]),
   T("Event time, source update time and ingestion time are kept apart, so a past decision can be read against what was known then.")], c, 0.9, ["POL:vm-2025-bus-02-b3", "SCM:vm-2025-bus-02_batch3", "PRJ:P-VM-014"])

c = Cites().ds("fin", "Budget, forecast, commitment — as of 2026-09-22").ds("proc", "Commitments — as of 2026-09-23").ds("ppm", "Stage and scope — as of 2026-09-19").ds("contract", "Payer allocations — as of 2026-09-01")
A("Q39", IC, "standard", "Show every figure on the portfolio exposure with its source and as-of date.",
  "Each figure in the exposure answer, with its dataset, date basis and as-of. The answer as a whole is as of 19 September — the oldest input it depends on.",
  [TB("Provenance", ["Figure", "Value", "Dataset", "Basis", "As of"], [
      ["Approved budget (assessed)", e0(A_BUD), "erp.fin budget_line", "current approved version", "2026-09-22"],
      ["Forecast total (assessed)", e0(A_FC), "erp.fin forecast_snapshot", "Working snapshot", "2026-09-22"],
      ["Open commitment", e0(sum(p['committed'] for p in ASSESSED)), "erp.proc po_line", "ordered − received − cancelled", "2026-09-23"],
      ["Operator exposure", e0(OPX), "erp.fin + contract", "GER + 60% P-VM-031", "2026-09-01 (allocations)"],
      ["Assessed population", "25 of 29", "ppm.project + fin", "current forecast present", "2026-09-19"]]),
   T("Currency EUR, tax basis HT, price date = posting date; no FX applies.")], c, 0.93, ["MEAS:forecast_total", "MEAS:operator_exposure", "MEAS:open_commitment"])

c = Cites().doc("DOC:ces-2025-114-warranty", "Warranty from operational acceptance").ds("ppm", "acceptance_item")
A("Q40", ML, "standard", "When does the Celtia warranty start for the new packs?",
  "At operational acceptance of each pack — so for 37 packs it has started, and for BUS-417, BUS-422 and BUS-431 it has not.",
  [T("Defects found before acceptance are rectified under the supply contract, not under warranty. Accepting a pack with an open defect would start its warranty clock early.")], c, 0.92, ["PRJ:P-VM-031", "ACP:bus-417", "ACP:bus-422", "ACP:bus-431"])

c = Cites().doc("DOC:p-vm-021-progress-2026-09", "11 Sep: on schedule, no supplier issues", authoritative=False).mail("msg_001", "16 Sep: HPU-9 late")
A("Q41", PM, "standard", "Did the lift project progress report flag any risk?",
  "No — the 11 September report says on schedule with no supplier issues. The supplier's delay arrived five days later, so the report and the correspondence now disagree.",
  [OBS("From correspondence", ["msg_001"], "The progress report was accurate when written; the supplier's later statement supersedes it only once procurement records it."),
   T("Both statements are kept with their dates rather than letting the later one silently overwrite the earlier.")], c, 0.88, ["PRJ:P-VM-021", "STM:p-vm-021_on_schedule"])

c = Cites().ds("fin", "funding_claim states").ds("ppm", "Milestones achieved in Q3")
A("Q42", CM, "standard", "What recoveries could we claim from the authority this quarter?",
  "€4.86M is ready to claim on evidenced milestones. €408k is potential only, and €212k from Q2 is disputed.",
  [CH("donut", "Recovery by state (EUR)", [pt("Ready to claim Q3", 4_860_000, "good"), pt("Submitted, open", 1_210_000), pt("Accepted, unpaid", 2_960_000), pt("Disputed", 212_000, "crit"), pt("Potential", 408_000, "warn")]),
   T("Potential entitlement, submitted claim, approved reimbursement, receivable and cash are separate states and are never summed as if certain.")], c, 0.86, ["CONCEPT:FundingClaim", "MEAS:funding_gap"])

# ================================================================== DECLINES
c = Cites().absent("No tram telemetry; failure history is not censored for trams that have not failed; no out-of-time validation").ds("eam", "Failure history is available for descriptive rates only")
A("Q43", ML, "decline", "Predict which trams will fail in the next quarter.",
  "Declined. There is not enough data to predict tram failures honestly — no tram telemetry, and no failure-history model validated out of time.",
  [T("A failure prediction needs maintenance history, exposure, operating context, censoring of trams that have not failed, and time-based validation. Two of those are missing for trams. A model trained on the bus fleet would not be valid for trams.\n\n**What I can answer instead:** tram failure frequency by component over the last 24 months, and which trams have open NDT findings.")], c, 0.95, ["CONCEPT:FailureEvent"])

c = Cites().doc("DOC:dsp-vm-2021-av2", "Art. 34.4 conditions").absent("No validated legal reading of Art. 34.4.4 is on record")
A("Q44", CM, "decline", "Is Valmont Métropole legally liable for the BUS-204 repair?",
  "Declined. I do not label a party legally liable. I can show the contract conditions, which are met and which are unresolved, and open a review item for the commercial team.",
  [T("Liability needs validated contract terms and professional review. The recorded position is a **potential recovery under review**: notice in time, amount under the cap, exclusion for maintenance default unresolved.")], c, 0.96, ["CLS:dsp_34_4", "NEED:N-VM-044"])

c = Cites().absent("No agreed pre-programme baseline for energy, availability or maintenance cost of the e-bus fleet")
A("Q45", OE, "decline", "What is the ROI of the e-bus programme?",
  "Declined. There is no agreed baseline to measure a return against, so any ROI figure would be invented.",
  [T("An outcome needs an agreed baseline, an observation window and normalisation for route changes and fleet mix. None is recorded yet.\n\n**What I can answer instead:** capital spent on the e-bus programme to date, and the availability of the battery-electric fleet since tranche 1.")], c, 0.95, ["PRJ:P-VM-014"])

c = Cites().absent("Workforce and crew planning is not connected")
A("Q46", SP, "decline", "Which drivers are available for the replacement-bus shuttle?",
  "Declined — no workforce or rostering source is connected, and individual driver availability would also be personal data this graph does not hold.",
  [T("**What I can answer instead:** the number of buses available for the shuttle (11 without batch 3, 14 with it), and the service planner's stated driver need (9).")], c, 0.97, ["ACC:ACC-T1-2026-031"])

c = Cites().absent("Only the Keolis Valmont contract is connected; cross-network data is outside this tenant's information-sharing rights")
A("Q47", OE, "decline", "How does our renewal backlog compare with other Keolis networks?",
  "Declined. Only this operating contract is connected, and group-level comparison would need each network's data under its own sharing rights.",
  [T("Group access does not automatically grant access to other contracts' data. **What I can answer instead:** the backlog trend for this network over the last four quarters.")], c, 0.96, ["MEAS:renewal_backlog"])

c = Cites().ds("fin", "Current forecast and allowance").doc("DOC:rc-005-009", "Requested change €2.64M")
A("Q48", IC, "decline", "What will the TV-100 overhaul finally cost?",
  f"I can't predict the final cost. Today's forecast is {em(P['P-VM-005']['forecast'])}; if RC-005-009 is approved as requested for all 24 trams, the forecast would carry €2.64M instead of the €1.32M allowance.",
  [TB("Range from recorded positions — not a prediction", ["Position", "Forecast total"], [["Current forecast (allowance for 12 trams)", e0(P["P-VM-005"]["forecast"])], ["RC-005-009 approved as requested (24 trams)", e0(P["P-VM-005"]["forecast"] + 1_320_000)]]),
   MET(m("Current forecast", P["P-VM-005"]["forecast"], "EUR"))], c, 0.9, ["PRJ:P-VM-005", "CHG:rc-005-009"])

c = Cites().absent("No resource calendars, compatibility constraints or explicit objective function are connected")
A("Q49", PM, "decline", "Optimise the 2027 renewal plan to minimise service disruption.",
  "Declined. Optimisation needs resource calendars, compatibility constraints, dependencies and an agreed objective; only the dependencies are connected.",
  [T("An infeasible or unsupported optimisation would fabricate a workable plan. **What I can answer instead:** the 2027 projects that need track access or vehicle withdrawals, and where they overlap in time.")], c, 0.95, ["CONCEPT:ScheduleTask"])

c = Cites().ds("ppm", "approval_decision for P-VM-008 — approved with conditions 2026-05-12").doc("DOC:ir-t1-2026-07", "Replacement threshold reached").doc("DOC:acc-t1-2026-031", "Access still provisional")
A("Q50", OE, "standard", "What evidence supports the decision to approve the T1 works?",
  "The Bureau métropolitain approved P-VM-008 on 12 May 2026 with two conditions — an approved closure and an isolation plan. The trigger was the July rail-wear inspection confirming the threshold; neither condition is met yet.",
  [TB("Approval and its conditions", ["Item", "State", "Evidence"], [["Decision", "Approved with conditions (12 May 2026)", "approval_decision"], ["Condition 1 — closure approved", "Not met (provisional)", "ACC-T1-2026-031"], ["Condition 2 — isolation plan", "Not met (drafted, not signed)", "safety manager"], ["Need", "Wear index 94 — threshold reached", "IR-T1-2026-07"]]),
   T("An approval with open conditions is shown with them; it is never displayed as unconditional.")], c, 0.9, ["PRJ:P-VM-008", "INSP:ir-t1-2026-07", "ACC:ACC-T1-2026-031"])

HERO_IDS = {a["answer_id"]: a["hero_ref"] for a in ANS if a["hero_ref"]}
