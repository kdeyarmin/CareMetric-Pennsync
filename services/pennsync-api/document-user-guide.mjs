// The user guide render, ported from base44/functions/generateUserGuidePDF.
//
// A pure builder over a jsPDF-shaped object, like the other documents here: a
// rendered PDF cannot be compared byte for byte, so parity is proved on the
// call sequence instead.
//
// What it draws comes from the model rather than from this module, so every
// level is optional and the original's tolerance is preserved exactly —
// `sections` may be absent, `content`, `subsections`, `steps` and `notes` may
// each be missing, and a guide with none of them still produces a cover page
// and a footer rather than a failure.
//
// Two details that look incidental and are not:
//
// - **The page break is per line.** An up-front check cannot catch a block
//   taller than a page, so the original checks before drawing each line. A
//   builder that checked once per block would draw off the bottom edge of long
//   model output, which is the common case here rather than the rare one.
// - **The date is supplied by the caller.** The original calls
//   `new Date().toLocaleDateString()` and `getFullYear()` while rendering, which
//   would make the output depend on when it ran. D12 settled this for the other
//   documents: the caller passes the date, so a parity test can compare two
//   renders at all.

/**
 * The margin the original fixes. Everything else is read from the document,
 * because the original reads it: it constructs jsPDF with `format: 'letter'`,
 * so the page is 215.9mm by 279.4mm rather than A4's 210 by 297. Hardcoding A4
 * here would have rendered every guide at the wrong size — which is what this
 * module did until the parity recorder disagreed with the original about the
 * width of the header bar.
 *
 * It is read as `pageSize.width`, a property, because that is what the original
 * reads. jsPDF also offers `getWidth()`, and the two are not interchangeable
 * for a stub.
 */
export const MARGIN = 15;
export const GUIDE_FORMAT = Object.freeze({ orientation: 'portrait', unit: 'mm', format: 'letter' });

export function buildUserGuide(doc, guideContent, { generatedOn, year } = {}) {
  const content = guideContent && typeof guideContent === 'object' ? guideContent : {};
  const PAGE_WIDTH = doc.internal.pageSize.width;
  const PAGE_HEIGHT = doc.internal.pageSize.height;
  const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
  let yPosition = 20;

  doc.setFillColor(59, 130, 246);
  doc.rect(0, 0, PAGE_WIDTH, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont(undefined, 'bold');
  doc.text(content.title || 'User Guide', PAGE_WIDTH / 2, 20, { align: 'center' });

  yPosition = 45;

  const checkNewPage = (neededSpace) => {
    if (yPosition + neededSpace > PAGE_HEIGHT - 20) {
      doc.addPage();
      yPosition = 20;
      return true;
    }
    return false;
  };

  const addWrappedText = (text, fontSize, color, isBold = false) => {
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    doc.setFont(undefined, isBold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH);
    // Per line, not per block: see the note at the top of this file.
    lines.forEach(line => {
      checkNewPage(fontSize * 0.4);
      doc.text(line, MARGIN, yPosition);
      yPosition += fontSize * 0.4;
    });
  };

  (content.sections || []).forEach((section) => {
    checkNewPage(15);
    doc.setFillColor(243, 244, 246);
    doc.rect(MARGIN - 2, yPosition - 5, CONTENT_WIDTH + 4, 12, 'F');
    addWrappedText(section.heading, 16, [31, 41, 55], true);
    yPosition += 5;

    if (section.content) {
      addWrappedText(section.content, 10, [75, 85, 99]);
      yPosition += 3;
    }

    section.subsections?.forEach((subsection) => {
      checkNewPage(20);

      doc.setFillColor(219, 234, 254);
      doc.rect(MARGIN, yPosition - 4, CONTENT_WIDTH, 8, 'F');
      addWrappedText(subsection.subheading, 12, [30, 64, 175], true);
      yPosition += 3;

      subsection.steps?.forEach((step) => {
        checkNewPage(10);
        doc.setFillColor(59, 130, 246);
        doc.circle(MARGIN + 3, yPosition - 1.5, 2, 'F');

        doc.setFontSize(10);
        doc.setTextColor(55, 65, 81);
        doc.setFont(undefined, 'normal');
        const stepLines = doc.splitTextToSize(step, CONTENT_WIDTH - 10);
        stepLines.forEach((line) => {
          doc.text(line, MARGIN + 8, yPosition);
          yPosition += 4;
        });
      });

      subsection.notes?.forEach((note) => {
        checkNewPage(15);
        doc.setFillColor(254, 243, 199);
        doc.setDrawColor(251, 191, 36);
        const noteLines = doc.splitTextToSize(note, CONTENT_WIDTH - 10);
        const boxHeight = (noteLines.length * 4) + 4;
        doc.rect(MARGIN, yPosition - 2, CONTENT_WIDTH, boxHeight, 'FD');

        doc.setFontSize(9);
        doc.setTextColor(146, 64, 14);
        doc.setFont(undefined, 'bold');
        doc.text('💡 TIP:', MARGIN + 3, yPosition + 2);

        doc.setFont(undefined, 'normal');
        noteLines.forEach((line, idx) => {
          doc.text(line, MARGIN + 15, yPosition + 2 + (idx * 4));
        });
        yPosition += boxHeight + 3;
      });

      yPosition += 3;
    });

    yPosition += 5;
  });

  // The footer walks the pages the body produced, so it runs after it.
  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(
      `PennSync - ${content.title} | Page ${i} of ${totalPages}`,
      PAGE_WIDTH / 2,
      PAGE_HEIGHT - 10,
      { align: 'center' },
    );
    doc.text(
      `Generated: ${generatedOn}`,
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - 10,
      { align: 'right' },
    );

    doc.setFontSize(7);
    doc.text(
      `© ${year} PennSync. All rights reserved.`,
      PAGE_WIDTH / 2,
      PAGE_HEIGHT - 5,
      { align: 'center' },
    );
  }
  return doc;
}
