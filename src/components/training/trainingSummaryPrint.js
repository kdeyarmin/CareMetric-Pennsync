import { escapeHtml } from '@/lib/escapeHtml';

export function trainingSummaryPrint(summary, generatedAt) {
  const overall = summary.overall;
  const pct = value => value == null ? 'Not assessed' : `${value}%`;
  const rows = summary.items.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.completed)}</td><td>${escapeHtml(row.total)}</td><td>${escapeHtml(pct(row.percentage))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Staff Training Progress Summary</title>
    <style>
      body{font-family:system-ui,sans-serif;margin:32px;color:#111;background:#fff;font-size:12pt;line-height:1.5}
      h1{font-size:22pt;margin-bottom:8px}h2{font-size:16pt}p{margin:8px 0}.meta{font-size:10pt}
      table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #777;padding:10px;text-align:left;overflow-wrap:anywhere}
      th{font-weight:700}thead{display:table-header-group}tr{break-inside:avoid}button{font:inherit;padding:8px 16px;cursor:pointer}
      @page{size:auto;margin:15mm}@media print{body{margin:0}.print-controls{display:none}h1,h2{break-after:avoid}}
    </style></head><body>
    <div class="print-controls"><button id="print-summary" type="button">Print / Save as PDF</button><p>Use Print to print this report or save it as a PDF.</p></div>
    <h1>Staff Training Progress Summary</h1><p>Nurse Training Hub</p><p class="meta">Generated ${escapeHtml(generatedAt)}</p>
    <h2>Overall course completion: ${escapeHtml(pct(overall.percentage))}</h2>
    <p>${escapeHtml(overall.completed)} of ${escapeHtml(overall.total)} assigned courses completed.</p>
    <p class="meta">Current active staff, all departments. Completed or passed courses divided by non-archived course assignments. This summary is independent of the assignment list filters.</p>
    <table><thead><tr><th scope="col">Department</th><th scope="col">Completed</th><th scope="col">Assigned</th><th scope="col">Completion</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No active course assignments for your current staff.</td></tr>'}</tbody></table>
    </body></html>`;
}