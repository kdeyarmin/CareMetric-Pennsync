// Bag Technique Checklist, ported from
// base44/functions/generateBagTechniquePDF/entry.ts.
//
// The layout is the original's, call for call; `pennsyncApiDocumentParity`
// runs both against one recording surface and compares. Two things are
// deliberately not carried, and `documents.mjs` says why: the logo is supplied
// rather than fetched from Base44 storage, and the date comes from the caller.

/**
 * Bag Technique Checklist, ported from base44/functions/generateBagTechniquePDF.
 *
 * The checklist text is clinical content used for state survey preparation and
 * is reproduced verbatim; changing any line here changes what a surveyor reads.
 */
export function buildBagTechniqueChecklist(doc, { logoDataUrl = null, generatedOn } = {}) {
  if (typeof generatedOn !== 'string' || !generatedOn) throw new TypeError('generatedOn is required');
  let y = 20;

  doc.setFillColor(79, 70, 229); // Indigo
  doc.rect(0, 0, 210, 35, 'F');
  // The original added the image here when its fetch succeeded, and skipped
  // straight to the title when it did not.
  if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont(undefined, 'bold');
  doc.text('Bag Technique Checklist', 105, 18, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text('State Survey Preparation - Infection Control Procedure', 105, 27, { align: 'center' });

  doc.setTextColor(0, 0, 0);
  y = 45;

  const drawSection = (title, items, color) => {
    doc.setFillColor(...color);
    doc.rect(15, y - 5, 180, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(title, 20, y + 1);
    y += 10;

    const startY = y;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');

    items.forEach((item) => {
      doc.setLineWidth(0.5);
      doc.rect(20, y - 3, 4, 4);
      const lines = doc.splitTextToSize(item, 160);
      doc.text(lines, 27, y);
      y += lines.length * 5;
    });

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(15, startY - 5, 180, y - startY + 5);
    y += 8;
  };

  drawSection('Before You Begin', [
    'Review the plan of care and provider\'s orders',
    'Introduce yourself and ask patient how they\'d like to be addressed',
    'Confirm patient understanding of procedure and gain informed consent',
    'Locate a hard surface near patient (table) and trash receptacle',
    'Follow organization\'s infection control policies',
  ], [139, 92, 246]); // Purple

  drawSection('Step 1: Prepare the Bag', [
    'Perform hand hygiene',
    'Remove cleansing wipes from outside pocket',
    'Clean the selected hard surface and let it dry',
    'Remove clean barrier from outside pocket and lay on dry surface',
    'Place bag on top of barrier',
    'Perform hand hygiene and open the bag',
    'Place down two barriers (clean area and dirty area)',
    'Obtain all necessary supplies and place on clean barrier',
    'Close the bag',
  ], [59, 130, 246]); // Blue

  if (y > 220) { doc.addPage(); y = 20; }

  drawSection('Step 2: Perform Patient Care', [
    'Perform hand hygiene and don gloves if indicated',
    'Perform patient care, placing used equipment on dirty barrier',
    'Dispose of waste in trash according to organizational policies',
    'If item forgotten: perform hand hygiene before retrieving from bag',
    'After care completion: discard all remaining disposable supplies',
    'Perform hand hygiene',
  ], [16, 185, 129]); // Green

  if (y > 200) { doc.addPage(); y = 20; }

  drawSection('Step 3: Clean Reusable Equipment', [
    'Don clean gloves',
    'Use sanitizing wipes/disinfectant per organizational policies',
    'Clean all equipment used or removed from clean barrier',
    'Follow manufacturer\'s contact time for disinfection',
    'Place cleaned equipment back on clean barrier to dry',
  ], [249, 115, 22]); // Orange

  if (y > 220) { doc.addPage(); y = 20; }

  drawSection('Step 4: Return Equipment to Bag', [
    'Doff used gloves using Aseptic Non Touch Technique',
    'Dispose of gloves in trash',
    'Perform hand hygiene',
    'Return cleaned items to the bag',
    'Close the bag',
    'Discard the barriers into the trash',
    'Perform hand hygiene',
  ], [99, 102, 241]); // Indigo

  if (y > 220) { doc.addPage(); y = 20; }

  drawSection('Step 5: Complete Procedure and Clean Up', [
    'Assess patient for tolerance of performed treatments',
    'Confirm understanding with teach-back as appropriate',
    'Document the procedure',
    'Follow up with provider on noted abnormalities as indicated',
  ], [20, 184, 166]); // Teal

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFillColor(245, 245, 245);
    doc.rect(0, 285, 210, 12, 'F');
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text('PennSync - Bag Technique Checklist', 20, 291);
    doc.text(`Generated: ${generatedOn}`, 105, 291, { align: 'center' });
    doc.text(`Page ${i} of ${pageCount}`, 190, 291, { align: 'right' });
  }
  return doc;
}

export const BAG_TECHNIQUE_FILENAME = 'Bag_Technique_Checklist.pdf';
