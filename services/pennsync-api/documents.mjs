// Documents ported out of Base44.
//
// Each builder is pure and takes a jsPDF-shaped object rather than constructing
// one, so the parity test can drive it with a recording surface and
// `handlers.mjs` can drive it with a real jsPDF. A rendered PDF cannot be
// compared byte for byte -- jsPDF stamps a creation time and a document id, so
// two runs of the same code differ -- so parity is proved on the drawing calls:
// same calls, same order, same arguments means the same page.
//
// Two things the originals did are deliberately not carried, where they did
// them:
//
// - **A logo is supplied, never fetched.** `generateBagTechniquePDF` fetched a
//   PNG from Base44's own storage bucket on every request, which would have
//   kept a Base44 dependency -- and a third-party fetch -- in a service that has
//   neither. It is now a configured data URL, and with none set the document
//   takes the branch the original already took when that fetch failed.
// - **A date is supplied.** `generateBagTechniquePDF` and
//   `generateSmartNoteGuide` called `new Date()` inside the builder, so the same
//   request produced a different document either side of midnight and its
//   parity could not be tested. Those builders refuse to invent one.
//
// `generateUserManual` did neither, so it ports verbatim.

export { BAG_TECHNIQUE_FILENAME, buildBagTechniqueChecklist } from './document-bag-technique.mjs';
export { SMART_NOTE_GUIDE_FILENAME, buildSmartNoteGuide } from './document-smart-note-guide.mjs';
export { USER_MANUAL_FILENAME, buildUserManual } from './document-user-manual.mjs';

/** Matches the originals' `new Date().toLocaleDateString()` for a footer. */
export const documentDate = (date = new Date()) => date.toLocaleDateString();
