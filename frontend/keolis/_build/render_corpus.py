"""Render the Drive corpus and the mailbox exports to PDF (and the two My Drive working copies
to DOCX/XLSX). Records page count, character count and chunk count per file in
_build/corpus_stats.json — the JSON builders read those, so the catalogue states what was rendered."""
import json, os, re, sys
from xml.sax.saxutils import escape
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import corpus as C

OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/keolis/out"
pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DVB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DVO", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("DV", normal="DV", bold="DVB", italic="DVO", boldItalic="DVB")

INK = colors.HexColor("#1f2937"); MUTED = colors.HexColor("#6b7280"); RULE = colors.HexColor("#d1d5db"); BAND = colors.HexColor("#f3f4f6")
ST = {
    "lh": ParagraphStyle("lh", fontName="DVB", fontSize=7.5, textColor=MUTED, leading=10, spaceAfter=6),
    "title": ParagraphStyle("title", fontName="DVB", fontSize=14, leading=18, textColor=INK, spaceAfter=10),
    "h": ParagraphStyle("h", fontName="DVB", fontSize=10.5, leading=14, textColor=INK, spaceBefore=8, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="DV", fontSize=9.2, leading=13.2, textColor=INK, spaceAfter=5),
    "cell": ParagraphStyle("cell", fontName="DV", fontSize=8.2, leading=10.5, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="DVB", fontSize=8.2, leading=10.5, textColor=INK),
    "sig": ParagraphStyle("sig", fontName="DVO", fontSize=8.5, leading=12, textColor=MUTED, spaceBefore=10),
    "foot": ParagraphStyle("foot", fontName="DV", fontSize=7, textColor=MUTED),
    "meta": ParagraphStyle("meta", fontName="DV", fontSize=8.2, leading=11, textColor=MUTED),
}
FOOT = "Hypothetical demo document — Keolis Valmont and Valmont Métropole are fictional · ContextWeave demo, 24 Sep 2026"

def _footer(canvas, doc):
    canvas.saveState(); canvas.setFont("DV", 6.8); canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10 * mm, FOOT)
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"page {doc.page}")
    canvas.restoreState()

def _table(header, rows, widths=None):
    data = [[Paragraph(escape(str(h)), ST["cellb"]) for h in header]] + [[Paragraph(escape(str(c)), ST["cell"]) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BAND), ("GRID", (0, 0), (-1, -1), 0.4, RULE),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    return t

def text_of(doc):
    parts = [doc["letterhead"], doc["title"]]
    for b in doc["body"]:
        k = b[0]
        if k in ("h", "p", "sig"): parts.append(b[1])
        elif k == "kv": parts += [f"{a}: {v}" for a, v in b[1]]
        elif k == "t": parts.append(" | ".join(b[1])); parts += [" | ".join(map(str, r)) for r in b[2]]
    return "\n".join(parts)

def build_pdf(path, letterhead, title, flow_blocks):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    story = [Paragraph(escape(letterhead), ST["lh"]), Paragraph(escape(title), ST["title"])]
    W = A4[0] - 36 * mm
    for b in flow_blocks:
        k = b[0]
        if k == "h": story.append(Paragraph(escape(b[1]), ST["h"]))
        elif k == "p": story.append(Paragraph(escape(b[1]), ST["p"]))
        elif k == "meta": story.append(Paragraph(b[1], ST["meta"]))
        elif k == "sig": story.append(Paragraph(escape(b[1]), ST["sig"]))
        elif k == "kv":
            rows = [[Paragraph(escape(a), ST["cellb"]), Paragraph(escape(str(v)), ST["cell"])] for a, v in b[1]]
            t = Table(rows, colWidths=[W * 0.3, W * 0.7], hAlign="LEFT")
            t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, RULE), ("BACKGROUND", (0, 0), (0, -1), BAND),
                                   ("INNERGRID", (0, 0), (-1, -1), 0.3, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            story += [t, Spacer(1, 6)]
        elif k == "t":
            n = len(b[1]); story += [_table(b[1], b[2], [W / n] * n), Spacer(1, 6)]
        elif k == "space": story.append(Spacer(1, b[1]))
    d = SimpleDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                          title=title, author="Keolis Valmont (hypothetical)")
    d.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return d.page

def chunks_for(chars):
    return max(1, round(chars / 950))

def render_docs():
    stats = {}
    root = os.path.join(OUT, "drive_corpus")
    fname = {f[0]: f for f in C.FOLDERS}
    for doc in C.DOCS:
        f = fname[doc["folder"]]
        drive_dir = C.DRIVE_NAME if f[3] == C.DRIVE_ID else "My Drive (Amélie Roussel)"
        folder_dir = os.path.join(root, drive_dir, f[2])
        path = os.path.join(folder_dir, doc["name"])
        txt = text_of(doc)
        if doc["mime_type"] == "application/pdf":
            pages = build_pdf(path, doc["letterhead"], doc["title"], doc["body"])
        elif doc["name"].endswith(".docx"):
            pages = build_docx(path, doc)
        else:
            pages = build_xlsx(path, doc)
        stats[doc["document_id"]] = dict(path=os.path.relpath(path, OUT), pages=pages, char_count=len(txt), chunk_count=chunks_for(len(txt)),
                                         size_mb=round(os.path.getsize(path) / 1e6, 2), text=txt)
    return stats

def build_docx(path, doc):
    import subprocess, tempfile
    os.makedirs(os.path.dirname(path), exist_ok=True)
    paras = [doc["title"]] + [b[1] for b in doc["body"] if b[0] == "p"] + [FOOT]
    js = """
const fs=require('fs');const {Document,Packer,Paragraph,TextRun,HeadingLevel}=require('docx');
const paras=%s;
const d=new Document({styles:{default:{document:{run:{font:'Arial',size:22}}}},sections:[{children:[
 new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun(paras[0])]}),
 ...paras.slice(1).map(t=>new Paragraph({spacing:{after:160},children:[new TextRun(t)]}))]}]});
Packer.toBuffer(d).then(b=>fs.writeFileSync(%s,b));""" % (json.dumps(paras), json.dumps(path))
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(js)
    subprocess.run(["node", fh.name], check=True)
    return 1

def build_xlsx(path, doc):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb = Workbook(); ws = wb.active; ws.title = "Claims Q3 (working)"
    t = next(b for b in doc["body"] if b[0] == "t")
    ws.append(["PPI claims tracker — Q3 2026 — WORKING COPY (not the controlled register)"]); ws["A1"].font = Font(bold=True)
    ws.append([]); ws.append(t[1])
    for c in ws[3]: c.font = Font(bold=True)
    for r in t[2]: ws.append(r)
    ws.append([]); ws.append([next(b[1] for b in doc["body"] if b[0] == "p")]); ws.append([FOOT])
    for col, w in zip("ABCD", (18, 12, 14, 16)): ws.column_dimensions[col].width = w
    wb.save(path)
    return 1

def render_mail():
    stats = {}
    root = os.path.join(OUT, "mailbox_export")
    for em, (fname, dept, project) in C.EXPORTS.items():
        msgs = [m for m in C.MAILS if m["thread"] == em]
        blocks = [("meta", escape(f"{em} · {len(msgs)} message(s) · exported from {C.MAILBOX} · pulled 2026-09-22 · label INBOX")), ("space", 4)]
        for m in msgs:
            blocks += [("h", m["subject"]),
                       ("kv", [("From", f'{m["from_name"]} <{m["from_addr"]}> — {m["from_org"]}'), ("To", m["to"]), ("Sent", m["sent_at"].replace("T", " ").replace("Z", " UTC")), ("Message-ID", m["message_id"])]),
                       ("p", m["body"])]
        head = f"KEOLIS VALMONT · CAPITAL RENEWAL MAILBOX EXPORT · {dept}"
        path = os.path.join(root, fname)
        pages = build_pdf(path, head, f"{em} — {msgs[0]['subject'].replace('RE: ', '')}", blocks)
        txt = head + "\n" + "\n".join(f"{m['subject']}\n{m['from_name']}\n{m['sent_at']}\n{m['body']}" for m in msgs)
        stats[em] = dict(path=os.path.relpath(path, OUT), name=fname, pages=pages, size_chars=len(txt), chunks=chunks_for(len(txt)),
                         snippet=txt[:260], messages=[m["message_id"] for m in msgs], project=project)
    return stats

if __name__ == "__main__":
    s = {"docs": render_docs(), "mail": render_mail()}
    with open(os.path.join(os.path.dirname(__file__), "corpus_stats.json"), "w") as fh:
        json.dump(s, fh, indent=1, ensure_ascii=False)
    print(len(s["docs"]), "docs;", len(s["mail"]), "mail exports;", sum(v["pages"] for v in s["docs"].values()), "doc pages")
