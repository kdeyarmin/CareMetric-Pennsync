// User Roster Report, ported from
// base44/functions/generateUserRosterPDF/entry.ts.
//
// The layout is the original's, call for call, with ONE column removed and the
// rest widened into the space it leaves. `documents.mjs` says why the logo is
// supplied rather than fetched and why the date comes from the caller; this
// file carries the one divergence that is its own.
//
// **There is no Name column, because there is no name.** The carried `user`
// table has no name field (D38, D46), so the original's
// `u.full_name || 'N/A'` has no source in this store. Three answers were
// possible and two are worse than the third: printing 'N/A' down the page
// gives a reader a column that means nothing, and substituting the verified
// address — which is what D46 did for `assigned_user_name` — would print the
// same string twice, because unlike D46's case there is an Email column right
// beside it. So the column goes, and the five that remain take its width.

/** The original's landscape page, so the port constructs the same document. */
export const ROSTER_FORMAT = 'landscape';
export const rosterFilename = (isoDate) => `User_Roster_${isoDate}.pdf`;

/** `u.care_scope` as the original renders it, including its 'Not Set' default. */
export function careScopeLabel(value) {
  if (value === 'home_health') return 'Home Health';
  if (value === 'hospice') return 'Hospice';
  if (value === 'both') return 'Both';
  return 'Not Set';
}

// The five columns and where each one starts, in the original's millimetres.
// Name began at 15 and Email at 75; with Name gone, Email takes 15 and the
// four after it move left by the same 60 that frees, keeping the original's
// gaps between them.
const COLUMNS = Object.freeze([
  Object.freeze({ header: 'Email', x: 15 }),
  Object.freeze({ header: 'Credential', x: 75 }),
  Object.freeze({ header: 'Role', x: 110 }),
  Object.freeze({ header: 'Care Scope', x: 140 }),
  Object.freeze({ header: 'Status', x: 190 }),
]);

function drawTableHeader(doc, y) {
  doc.setFillColor(59, 130, 246);
  doc.rect(10, y, 277, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  for (const column of COLUMNS) doc.text(column.header, column.x, y + 7);
  doc.setTextColor(0, 0, 0);
}

/**
 * The roster report.
 *
 * `entries` are `contract_roster_report`'s, and `summary` is the contract's
 * too — counted over the WHOLE agency rather than over this page, because the
 * original counts its entire unpaged list and a total that described only the
 * first page would be worse than none.
 */
export function buildUserRoster(doc, { entries, summary }, { logoDataUrl = null, generatedOn } = {}) {
  if (typeof generatedOn !== 'string' || !generatedOn) throw new TypeError('generatedOn is required');
  if (!Array.isArray(entries)) throw new TypeError('entries is required');
  if (!summary || typeof summary !== 'object') throw new TypeError('summary is required');
  let y = 20;

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, 297, 35, 'F');
  // The original added the image here when its fetch succeeded and skipped to
  // the title when it did not — and when it did not, it also dropped the
  // subtitle line. Both branches are kept.
  if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont(undefined, 'bold');
  doc.text('User Roster Report', 148.5, 18, { align: 'center' });
  if (logoDataUrl) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text(`Generated: ${generatedOn} | Total Users: ${summary.total}`, 148.5, 27,
      { align: 'center' });
  }

  doc.setTextColor(0, 0, 0);
  y = 45;
  drawTableHeader(doc, y);
  y += 12;

  entries.forEach((entry, index) => {
    if (y > 185) {
      doc.addPage(ROSTER_FORMAT);
      y = 20;
      drawTableHeader(doc, y);
      y += 12;
    }
    if (index % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(10, y - 2, 277, 8, 'F');
    }
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(entry.email || '', COLUMNS[0].x, y + 4);
    doc.text(entry.credential_type || 'N/A', COLUMNS[1].x, y + 4);
    // The TENANT role, which is the authority store's and cannot be edited by
    // its subject. The original printed `u.role || 'user'` — the Base44
    // built-in, which is `'user'` for everybody but the platform tier D14 and
    // D22 removed, so it was a column of one value.
    doc.text(entry.tenant_role || '', COLUMNS[2].x, y + 4);
    doc.text(careScopeLabel(entry.care_scope), COLUMNS[3].x, y + 4);
    // Derived from the identity being enabled rather than read from the
    // self-editable `is_approved` boolean. A colleague whose login is disabled
    // while their membership stands is exactly who should read as pending.
    const approved = entry.is_approved === true;
    doc.setTextColor(...(approved ? [34, 197, 94] : [234, 179, 8]));
    doc.text(approved ? 'Approved' : 'Pending', COLUMNS[4].x, y + 4);
    doc.setTextColor(0, 0, 0);
    y += 8;
  });

  if (y > 160) {
    doc.addPage(ROSTER_FORMAT);
    y = 20;
  }
  y += 10;
  doc.setFillColor(243, 244, 246);
  doc.rect(10, y, 277, 25, 'F');
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Summary', 15, y + 8);
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Total Users: ${summary.total}`, 15, y + 15);
  doc.text(`Approved: ${summary.approved}`, 80, y + 15);
  doc.text(`Pending: ${summary.pending}`, 145, y + 15);
  doc.text(`RN: ${summary.rn}`, 210, y + 15);
  doc.text(`LPN: ${summary.lpn}`, 250, y + 15);

  const pageCount = doc.internal.pages.length - 1;
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFillColor(249, 250, 251);
    doc.rect(0, 200, 297, 10, 'F');
    doc.setTextColor(107, 114, 128);
    doc.setFontSize(8);
    doc.text(`PennSync - User Roster - Page ${page} of ${pageCount}`, 148.5, 205,
      { align: 'center' });
  }
  return doc;
}
