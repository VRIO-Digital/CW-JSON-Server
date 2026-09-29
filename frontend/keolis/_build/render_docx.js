// Render a simple document spec (JSON) to .docx with docx-js.
// spec: { title, subtitle, footer, blocks: [ {h1|h2|p|bullets|table|note} ] }
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
        AlignmentType, LevelFormat, Footer, PageNumber, BorderStyle } = require('docx');

const [,, specPath, outPath] = process.argv;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const W = 9360; // content width, DXA (US letter 1" margins)
const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9CED6' };
const borders = { top: border, bottom: border, left: border, right: border };

function runs(text, opts = {}) {
  // **bold** segments
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map(p => p.startsWith('**') ? new TextRun({ text: p.slice(2, -2), bold: true, ...opts }) : new TextRun({ text: p, ...opts }));
}
function table(t) {
  const n = t.header.length;
  const widths = t.widths || Array(n).fill(Math.floor(W / n));
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (txt, i, head) => new TableCell({ borders, width: { size: widths[i], type: WidthType.DXA },
    shading: head ? { fill: 'EEF1F5', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: runs(txt, { bold: !!head, size: 18 }) })] });
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: t.header.map((h, i) => cell(h, i, true)) }),
           ...t.rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))] });
}
const children = [
  new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(spec.title)] }),
];
if (spec.subtitle) children.push(new Paragraph({ spacing: { after: 240 }, children: runs(spec.subtitle, { color: '5B6472' }) }));
for (const b of spec.blocks) {
  if (b.h1) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(b.h1)] }));
  else if (b.h2) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.h2)] }));
  else if (b.p) children.push(new Paragraph({ spacing: { after: 140 }, children: runs(b.p) }));
  else if (b.note) children.push(new Paragraph({ spacing: { after: 140 }, children: runs(b.note, { italics: true, color: '5B6472' }) }));
  else if (b.bullets) b.bullets.forEach(x => children.push(new Paragraph({ numbering: { reference: 'bul', level: 0 }, children: runs(x) })));
  else if (b.code) b.code.split('\n').forEach(line => children.push(new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })] })));
  else if (b.table) { children.push(table(b.table)); children.push(new Paragraph({ children: [] })); }
}
const doc = new Document({
  styles: { default: { document: { run: { font: 'Arial', size: 21 } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 40, bold: true, color: '1F2937' }, paragraph: { spacing: { after: 120 } } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: '1F2937' }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, color: '374151' }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } }] },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: spec.footer + '  ·  page ', size: 15, color: '8A93A0' }), new TextRun({ children: [PageNumber.CURRENT], size: 15, color: '8A93A0' })] })] }) },
    children }] });
Packer.toBuffer(doc).then(b => fs.writeFileSync(outPath, b));
