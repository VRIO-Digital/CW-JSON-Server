// Writes the two template files the walk uploads: the template as it is given out, and a copy a person has edited.
import * as XLSX from 'xlsx'
import { templateWorkbook, TEMPLATE_COLUMNS } from '../src/data/templateFile'
const dir = new URL('./fixtures/', import.meta.url).pathname
XLSX.writeFile(templateWorkbook(), `${dir}Contract_Risk_Scorecard_Template.xlsx`)
const wb = templateWorkbook(), ws = wb.Sheets.Scorecard
const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' })
const S = TEMPLATE_COLUMNS.indexOf('Signal'), B1 = TEMPLATE_COLUMNS.indexOf('Scores 1 when (good)')
const out = rows.filter((r) => r[S] !== 'Unionized workforce' && r[S] !== 'Talk of in-house operation or a re-bid')
for (const r of out) if (r[S] === 'Days sales outstanding') r[B1] = 'Under 30 days'
out.push(['What we control', 'Commercial Terms', '', 'Invoices the client pays late', 10, 'None in 12 months', '1 or 2', '3 to 5', 'More than 5', 'Count of invoices paid after the due date', ''])
out.push(['What we do not control', 'Energy market', 8, 'Power price against budget', 100, 'At or under budget', 'Up to 5% over', '5% to 10% over', 'More than 10% over', 'Average power price paid against the budget price', ''])
const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(out), 'Scorecard')
XLSX.writeFile(wb2, `${dir}My_Risk_Scorecard.xlsx`)
XLSX.writeFile((() => { const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([['Month', 'Revenue'], ['Jan', 10]]), 'Sheet1'); return w })(), `${dir}Not_a_template.xlsx`)
console.log('fixtures written:', out.length - 1, 'rows in the edited template')
