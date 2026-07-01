// Compatibility shim. The duplicate-detection engine lives in the sibling `.js`
// file (node-loadable so the unit tests run under the plain node test runner).
// This `.jsx` re-export exists only because several surfaces import the utility
// by its bare path (`@/components/patient/patientDuplicateUtils`), which Vite may
// resolve to `.jsx`. Re-exporting guarantees every surface — scanner, add-patient
// guard, Duplicate Patients page, and the OASIS patient matcher — runs the exact
// same engine, with no shadowing or drift.
export * from './patientDuplicateUtils.js';