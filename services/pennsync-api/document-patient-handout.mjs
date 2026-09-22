// Patient education handout, ported from
// base44/functions/generatePatientHandout/entry.ts.
//
// The layout is the original's, call for call, for every condition and every
// style the published client can send; `pennsyncApiDocumentParity` runs both
// against one recording surface and compares. As for every ported document
// (see documents.mjs), two values are supplied rather than computed: the logo,
// which the original fetched from Base44's storage bucket on every request,
// and the date, which it read from the clock inside the renderer.
//
// The per-block `try`/`catch` structure is the original's too, including the
// red "[Could not render: …]" line a failed section leaves in the document,
// and the parity test drives a failure through both to prove it. What is not
// carried is the `console.error` in each catch: a builder does no I/O, and the
// marker in the document is the signal the original's reader saw.
//
// The template text is in `patient-handout-templates.mjs`, compared against the
// original's source byte for byte.
import { HANDOUT_CHECKLISTS, HANDOUT_RESOURCES, HANDOUT_TEMPLATES } from './patient-handout-templates.mjs';

// Strip non-ASCII so jsPDF's core fonts render cleanly. The original's
// function, unchanged — so "100.4°F" in a template prints as "100.4F" here
// exactly as it did there.
export const clean = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7F]/g, '');

export const HANDOUT_LAYOUTS = Object.freeze({
  standard: Object.freeze({ margin: 18, lineSpacing: 6, titleSize: 22, headingSize: 13, bodySize: 11 }),
  compact: Object.freeze({ margin: 14, lineSpacing: 5, titleSize: 19, headingSize: 12, bodySize: 10 }),
  large_print: Object.freeze({ margin: 18, lineSpacing: 8, titleSize: 26, headingSize: 16, bodySize: 14 }),
  two_column: Object.freeze({ margin: 16, lineSpacing: 6, titleSize: 21, headingSize: 13, bodySize: 11 }),
});

// Brand palette. Navy primary + gold accent gives a polished clinical look.
export const HANDOUT_COLOR_SCHEMES = Object.freeze({
  penn_health: { primary: [33, 58, 118], primaryLight: [238, 243, 252], accent: [200, 145, 30], text: [30, 41, 59], textLight: [100, 116, 139] },
  professional_blue: { primary: [21, 101, 192], primaryLight: [227, 242, 253], accent: [2, 119, 189], text: [38, 50, 56], textLight: [96, 125, 139] },
  warm_care: { primary: [154, 52, 18], primaryLight: [255, 243, 224], accent: [217, 119, 6], text: [62, 39, 35], textLight: [121, 85, 72] },
  serene_green: { primary: [22, 101, 52], primaryLight: [232, 245, 233], accent: [101, 163, 13], text: [27, 94, 32], textLight: [76, 175, 80] },
  elegant_purple: { primary: [88, 28, 135], primaryLight: [243, 229, 245], accent: [147, 51, 234], text: [74, 20, 140], textLight: [142, 36, 170] },
});

export const HANDOUT_FONTS = Object.freeze(['helvetica', 'times', 'courier']);

/** Matches the original's `toLocaleDateString('en-US', { month: 'long', … })`. */
export const handoutDate = (date) =>
  date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export const handoutFilename = (condition) => `${condition}_handout.pdf`;

/**
 * The original's style defaults. Each falsy value takes the default, which is
 * how an empty string from the client's form means "unset".
 *
 * `customHeader` is carried and never drawn, because the original never drew
 * it: the client offers a Custom Header field whose value reaches no page.
 */
export function handoutStyle(styleOptions) {
  return {
    colorScheme: styleOptions?.colorScheme || 'penn_health',
    fontFamily: styleOptions?.fontFamily || 'helvetica',
    layout: styleOptions?.layout || 'standard',
    customHeader: styleOptions?.customHeader || '',
    customFooter: styleOptions?.customFooter || '',
    agencyName: styleOptions?.agencyName || 'PennSync',
    agencyPhone: styleOptions?.agencyPhone || '',
  };
}

/**
 * The sections the caller kept, by the original's rule: a section is dropped
 * only when its selection says `included: false`. Every other value, a
 * missing one included, keeps it.
 */
export function selectedHandoutSections(template, selectedSections) {
  let sectionsToInclude = template.sections || [];
  if (selectedSections && typeof selectedSections === 'object') {
    sectionsToInclude = sectionsToInclude.filter((section) => {
      if (!selectedSections[section.heading]) return true;
      return selectedSections[section.heading]?.included !== false;
    });
  }
  return sectionsToInclude;
}

export function buildPatientHandout(doc, request, { logoDataUrl = null, generatedOn } = {}) {
  if (typeof generatedOn !== 'string' || !generatedOn) throw new TypeError('generatedOn is required');
  const { condition, patientName, selectedSections, customNotes, styleOptions } = request || {};
  if (typeof condition !== 'string' || !Object.hasOwn(HANDOUT_TEMPLATES, condition)) {
    throw new TypeError('condition is not a handout');
  }
  const style = handoutStyle(styleOptions);
  // The original had no fallback here: an unknown scheme spread `undefined`
  // into the palette and the first fill threw. The handler refuses one first.
  if (!Object.hasOwn(HANDOUT_COLOR_SCHEMES, style.colorScheme)) throw new TypeError('colorScheme is not a scheme');
  const template = HANDOUT_TEMPLATES[condition];

  doc.setProperties({ title: template.title, subject: 'Patient Education Material', author: style.agencyName, keywords: 'patient education, healthcare, ' + condition, creator: 'PennSync Documentation System', language: 'en-US' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const config = Object.hasOwn(HANDOUT_LAYOUTS, style.layout) ? HANDOUT_LAYOUTS[style.layout] : HANDOUT_LAYOUTS.standard;
  const margin = config.margin;
  const contentWidth = pageWidth - 2 * margin;

  const COLORS = {
    ...HANDOUT_COLOR_SCHEMES[style.colorScheme],
    emergency: [185, 28, 28], emergencyLight: [254, 235, 235],
    important: [180, 83, 9], importantLight: [255, 247, 230],
    success: [16, 185, 129], divider: [226, 232, 240]
  };

  const FONT_SIZE_TITLE = config.titleSize;
  const FONT_SIZE_HEADING = config.headingSize;
  const FONT_SIZE_SUBHEADING = config.headingSize - 1;
  const FONT_SIZE_BODY = config.bodySize;
  const FONT_SIZE_SMALL = config.bodySize - 2;
  const LINE_SPACING = config.lineSpacing;
  const fontFamily = style.fontFamily === 'times' ? 'times' : style.fontFamily === 'courier' ? 'courier' : 'helvetica';

  const setColor = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw = (c) => doc.setDrawColor(c[0], c[1], c[2]);

  const TOP_BAND_H = 26;
  const FOOTER_H = 18;
  const CONTENT_TOP = TOP_BAND_H + 10;
  const CONTENT_BOTTOM = pageHeight - FOOTER_H - 6;

  // Brand banner painted on every page — navy band, gold rule, logo + contact.
  const paintBanner = () => {
    setFill(COLORS.primary);
    doc.rect(0, 0, pageWidth, TOP_BAND_H, 'F');
    setFill(COLORS.accent);
    doc.rect(0, TOP_BAND_H, pageWidth, 1.4, 'F');
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', margin, 5.5, 40, 15); } catch { /* optional */ }
    } else {
      doc.setFont(fontFamily, 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
      doc.text(clean(style.agencyName), margin, 16);
    }
    doc.setFont(fontFamily, 'normal'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    doc.text(clean(style.agencyPhone), pageWidth - margin, 11, { align: 'right' });
    doc.text('caremetric.ai', pageWidth - margin, 16, { align: 'right' });
    doc.text('Patient Education', pageWidth - margin, 21, { align: 'right' });
  };

  let pageNumber = 1;
  const paintFooter = () => {
    const fy = pageHeight - FOOTER_H;
    setDraw(COLORS.divider); doc.setLineWidth(0.4);
    doc.line(margin, fy, pageWidth - margin, fy);
    setFill(COLORS.accent);
    doc.rect(margin, fy, 12, 0.8, 'F');
    doc.setFontSize(FONT_SIZE_SMALL - 1); doc.setFont(fontFamily, 'normal'); setColor(COLORS.textLight);
    const footerText = style.customFooter
      ? clean(style.customFooter)
      : 'For educational purposes only. Always follow your healthcare provider\'s advice.';
    doc.text(doc.splitTextToSize(footerText, contentWidth - 30)[0], margin, fy + 6);
    doc.setFont(fontFamily, 'bold'); setColor(COLORS.primary);
    doc.text(clean(style.agencyName), margin, fy + 11);
    doc.setFont(fontFamily, 'normal'); setColor(COLORS.textLight);
    doc.text(style.agencyPhone ? `${clean(style.agencyPhone)}  |  caremetric.ai` : 'caremetric.ai', pageWidth - margin, fy + 11, { align: 'right' });
    doc.text(`Page ${pageNumber}`, pageWidth - margin, fy + 6, { align: 'right' });
  };

  let yPos = CONTENT_TOP;
  const newPage = () => { paintFooter(); doc.addPage(); pageNumber += 1; paintBanner(); yPos = CONTENT_TOP; };
  const ensureSpace = (needed) => { if (yPos + needed > CONTENT_BOTTOM) newPage(); };

  // ---- Page 1 cover area ----
  paintBanner();

  // Title block on a soft tinted panel with a gold accent rule.
  setFill(COLORS.primaryLight);
  doc.roundedRect(margin, yPos, contentWidth, 26, 2, 2, 'F');
  setFill(COLORS.accent);
  doc.rect(margin, yPos, 3, 26, 'F');
  doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_SMALL); setColor(COLORS.accent);
  doc.text('PATIENT EDUCATION GUIDE', margin + 9, yPos + 9);
  doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_TITLE); setColor(COLORS.primary);
  const titleLines = doc.splitTextToSize(clean(template.title), contentWidth - 16);
  doc.text(titleLines, margin + 9, yPos + 19);
  yPos += 26 + (titleLines.length > 1 ? (titleLines.length - 1) * 8 : 0) + 8;

  // Patient info card. The original read the clock here; the day is supplied.
  const dateStr = generatedOn;
  setFill([255, 255, 255]); setDraw(COLORS.divider); doc.setLineWidth(0.5);
  doc.roundedRect(margin, yPos, contentWidth, 16, 2, 2, 'FD');
  doc.setFontSize(FONT_SIZE_SMALL); doc.setFont(fontFamily, 'bold'); setColor(COLORS.textLight);
  doc.text('PREPARED FOR', margin + 6, yPos + 6);
  doc.setFontSize(FONT_SIZE_BODY); doc.setFont(fontFamily, 'bold'); setColor(COLORS.text);
  doc.text(clean(patientName) || 'Patient', margin + 6, yPos + 12);
  doc.setFontSize(FONT_SIZE_SMALL); doc.setFont(fontFamily, 'bold'); setColor(COLORS.textLight);
  doc.text('DATE PROVIDED', pageWidth - margin - 6, yPos + 6, { align: 'right' });
  doc.setFontSize(FONT_SIZE_BODY); doc.setFont(fontFamily, 'normal'); setColor(COLORS.text);
  doc.text(dateStr, pageWidth - margin - 6, yPos + 12, { align: 'right' });
  yPos += 22;

  const sectionsToInclude = selectedHandoutSections(template, selectedSections);

  // Renders a "• " bullet with hanging indent and a small accent dot.
  const renderBullet = (text, indent, dotColor) => {
    const lines = doc.splitTextToSize(clean(text), contentWidth - indent - 6);
    ensureSpace(lines.length * LINE_SPACING + 1);
    setFill(dotColor);
    doc.circle(margin + indent + 1.2, yPos - 1.6, 0.9, 'F');
    doc.setFont(fontFamily, 'normal'); doc.setFontSize(FONT_SIZE_BODY); setColor(COLORS.text);
    lines.forEach((line, i) => { doc.text(line, margin + indent + 5, yPos); if (i < lines.length - 1) yPos += LINE_SPACING; });
    yPos += LINE_SPACING;
  };

  for (let sIdx = 0; sIdx < sectionsToInclude.length; sIdx++) {
    const section = sectionsToInclude[sIdx];
    try {
      ensureSpace(18);
      const tone = section.emergency ? COLORS.emergency : section.important ? COLORS.important : COLORS.primary;

      // Section heading: tinted pill with a colored accent bar.
      const headTone = section.emergency ? COLORS.emergencyLight : section.important ? COLORS.importantLight : COLORS.primaryLight;
      setFill(headTone);
      doc.roundedRect(margin, yPos - 5, contentWidth, 11, 1.5, 1.5, 'F');
      setFill(tone);
      doc.rect(margin, yPos - 5, 2.5, 11, 'F');
      doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_HEADING); setColor(tone);
      doc.text(clean(section.heading || 'Section'), margin + 7, yPos + 2);
      yPos += 12;
      setColor(COLORS.text);

      // Section intro paragraph (optionally a highlighted callout).
      if (section.content && typeof section.content === 'string') {
        if (section.highlight) {
          const lines = doc.splitTextToSize(clean(section.content), contentWidth - 14);
          const boxH = lines.length * LINE_SPACING + 8;
          ensureSpace(boxH + 2);
          setFill(COLORS.primaryLight); setDraw(COLORS.primary); doc.setLineWidth(0.4);
          doc.roundedRect(margin, yPos - 4, contentWidth, boxH, 2, 2, 'FD');
          setFill(COLORS.accent);
          doc.rect(margin, yPos - 4, 2.5, boxH, 'F');
          doc.setFont(fontFamily, 'normal'); doc.setFontSize(FONT_SIZE_BODY); setColor(COLORS.text);
          lines.forEach((line) => { doc.text(line, margin + 8, yPos + 1); yPos += LINE_SPACING; });
          yPos += 8;
        } else {
          const lines = doc.splitTextToSize(clean(section.content), contentWidth - 2);
          doc.setFont(fontFamily, 'normal'); doc.setFontSize(FONT_SIZE_BODY); setColor(COLORS.text);
          lines.forEach((line) => { ensureSpace(LINE_SPACING); doc.text(line, margin + 1, yPos); yPos += LINE_SPACING; });
          yPos += 3;
        }
      }

      // Subsections.
      if (Array.isArray(section.subsections)) {
        for (const sub of section.subsections) {
          try {
            ensureSpace(10);
            doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_SUBHEADING); setColor(COLORS.accent);
            doc.text(clean(sub.subheading || 'Details'), margin + 3, yPos);
            setDraw(COLORS.divider); doc.setLineWidth(0.3);
            const sw = doc.getTextWidth(clean(sub.subheading || 'Details'));
            doc.line(margin + 6 + sw, yPos - 1, pageWidth - margin, yPos - 1);
            yPos += 7;
            if (Array.isArray(sub.bullets)) for (const b of sub.bullets) renderBullet(b, 8, COLORS.accent);
            yPos += 3;
          } catch { yPos += 6; }
        }
      }

      // Bullets. Only a section's own bullets can be deselected; a
      // subsection's always print, as they did in the original.
      if (Array.isArray(section.bullets)) {
        let bullets = section.bullets;
        if (selectedSections?.[section.heading]?.bullets) {
          bullets = section.bullets.filter((b, i) => selectedSections[section.heading].bullets[i] !== false);
        }
        const bulletDot = section.emergency ? COLORS.emergency : section.important ? COLORS.important : COLORS.accent;
        for (const b of bullets) renderBullet(b, 2, bulletDot);
        yPos += 3;
      }
      yPos += 4;
    } catch {
      doc.setFontSize(FONT_SIZE_BODY); doc.setFont('helvetica', 'italic'); doc.setTextColor(200, 0, 0);
      doc.text(`[Could not render: ${clean(section.heading)}]`, margin + 3, yPos);
      yPos += 8; setColor(COLORS.text);
    }
  }

  // Custom nurse notes callout.
  if (customNotes && typeof customNotes === 'string' && customNotes.trim()) {
    try {
      const lines = doc.splitTextToSize(clean(customNotes), contentWidth - 16);
      const boxH = lines.length * LINE_SPACING + 16;
      ensureSpace(boxH + 4);
      yPos += 4;
      setFill(COLORS.importantLight); setDraw(COLORS.important); doc.setLineWidth(0.5);
      doc.roundedRect(margin, yPos - 4, contentWidth, boxH, 2, 2, 'FD');
      setFill(COLORS.important);
      doc.rect(margin, yPos - 4, 2.5, boxH, 'F');
      doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_SUBHEADING); setColor(COLORS.important);
      doc.text('Special Instructions from Your Nurse', margin + 8, yPos + 3);
      yPos += 10;
      doc.setFont(fontFamily, 'normal'); doc.setFontSize(FONT_SIZE_BODY); setColor(COLORS.text);
      lines.forEach((line) => { doc.text(line, margin + 8, yPos); yPos += LINE_SPACING; });
      yPos += 10;
    } catch { /* the original logged and carried on */ }
  }

  // Daily self-care checklist (boxed card).
  const checklist = HANDOUT_CHECKLISTS[condition];
  if (checklist && checklist.length) {
    try {
      ensureSpace(30); yPos += 4;
      doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_HEADING); setColor(COLORS.primary);
      doc.text('Daily Self-Care Checklist', margin, yPos);
      yPos += 7;
      checklist.forEach((item) => {
        const lines = doc.splitTextToSize(clean(item), contentWidth - 14);
        ensureSpace(Math.max(lines.length * LINE_SPACING, 7));
        setDraw(COLORS.primary); doc.setLineWidth(0.5);
        doc.roundedRect(margin + 1, yPos - 4, 4.5, 4.5, 0.8, 0.8, 'S');
        doc.setFont(fontFamily, 'normal'); doc.setFontSize(FONT_SIZE_BODY); setColor(COLORS.text);
        lines.forEach((line, i) => doc.text(line, margin + 9, yPos + i * LINE_SPACING));
        yPos += Math.max(LINE_SPACING * lines.length, 7);
      });
      doc.setFont(fontFamily, 'italic'); doc.setFontSize(FONT_SIZE_SMALL); setColor(COLORS.textLight);
      ensureSpace(8);
      doc.text('Check off each item as you complete it daily.', margin + 1, yPos + 2);
      yPos += 10;
    } catch { /* the original logged and carried on */ }
  }

  // Weekly symptom tracker table.
  try {
    ensureSpace(60); yPos += 4;
    doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_HEADING); setColor(COLORS.primary);
    doc.text('Daily Symptom Tracker', margin, yPos);
    yPos += 7;
    const headers = ['Date', 'Symptoms', 'Notes'];
    const colW = contentWidth / 3;
    const rowH = 11;
    setFill(COLORS.primary);
    doc.roundedRect(margin, yPos, contentWidth, rowH, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_SMALL);
    headers.forEach((h, i) => doc.text(h, margin + 4 + i * colW, yPos + 7));
    yPos += rowH;
    setDraw(COLORS.divider); doc.setLineWidth(0.4);
    for (let i = 0; i < 7; i++) {
      if (i % 2 === 1) { setFill([248, 250, 252]); doc.rect(margin, yPos, contentWidth, rowH, 'F'); }
      doc.rect(margin, yPos, contentWidth, rowH);
      doc.line(margin + colW, yPos, margin + colW, yPos + rowH);
      doc.line(margin + colW * 2, yPos, margin + colW * 2, yPos + rowH);
      yPos += rowH;
    }
    doc.setFont(fontFamily, 'italic'); doc.setFontSize(FONT_SIZE_SMALL); setColor(COLORS.textLight);
    doc.text('Record daily symptoms and bring this log to your appointments.', margin + 1, yPos + 6);
    yPos += 12;
  } catch { /* the original logged and carried on */ }

  // Helpful online resources with clickable links.
  const resources = HANDOUT_RESOURCES[condition];
  if (resources && resources.length) {
    try {
      ensureSpace(30); yPos += 4;
      doc.setFont(fontFamily, 'bold'); doc.setFontSize(FONT_SIZE_HEADING); setColor(COLORS.primary);
      doc.text('Helpful Online Resources', margin, yPos);
      yPos += 8;
      doc.setFont(fontFamily, 'normal'); doc.setFontSize(FONT_SIZE_BODY);
      resources.forEach((r) => {
        ensureSpace(LINE_SPACING + 3);
        setFill(COLORS.accent);
        doc.circle(margin + 2, yPos - 1.6, 0.9, 'F');
        setColor(COLORS.primary);
        const txt = clean(r.text);
        doc.textWithLink(txt, margin + 6, yPos, { url: r.url });
        const w = doc.getTextWidth(txt);
        setDraw(COLORS.primary); doc.setLineWidth(0.3);
        doc.line(margin + 6, yPos + 1, margin + 6 + w, yPos + 1);
        yPos += LINE_SPACING + 2;
      });
      doc.setFont(fontFamily, 'italic'); doc.setFontSize(FONT_SIZE_SMALL); setColor(COLORS.textLight);
      doc.text('Tap the blue links above to visit these trusted websites.', margin + 1, yPos + 2);
      yPos += 10;
    } catch { /* the original logged and carried on */ }
  }

  // Finalize footer on the last page.
  paintFooter();
  return doc;
}
