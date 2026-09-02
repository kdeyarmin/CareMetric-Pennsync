// pennsync-oasis-response-v2-cms-e2 — CMS-aligned response sets for PennSync's
// supported OASIS-E2 item subset, plus the three PennSync screening prompts that
// were demoted out of the M-number namespace.
//
// PROVENANCE
// Every `codes` array here was transcribed from the FINAL OASIS-E2 All-Item
// instrument effective 2026-04-01 (see `sources.js` for URL, dates and SHA-256).
// Applicability was derived from the final Time Point instruments. Nothing was
// reconstructed from memory, and PennSync's own labels were not used as a source.
//
// SCOPE — read this before extending the file
// This is a SUBSET. It covers the 15 items whose response sets PennSync had
// wrong, not the OASIS instrument. PennSync is a companion reference: it does
// not submit assessments to iQIES and does not certify any response.
//
// CODES ARE OPAQUE STRINGS. "01" is not 1; "9", "NA" and "UK" are not numbers.
// See `shapes.js`.

import { CMS_SOURCES, V2_DERIVATION } from "./sources.js";

const ALL = CMS_SOURCES.e2_all_items_2026_04_01.id;

/** Shorthand for the shared provenance block on a CMS-derived definition. */
function cms(citation, timepoints) {
  return {
    item_source: "cms_item",
    item_spec_version: "oasis-e2",
    source_id: ALL,
    citation,
    source_verification: "verified_against_final_cms_source",
    source_verified_at: V2_DERIVATION.derived_at,
    // Deliberately NOT "approved". Kevin Deyarmin's 2026-09-01 sign-off
    // explicitly excluded individual response-option verification, so no
    // clinical reviewer has yet approved these option sets.
    clinical_review: "pending_named_sme_review",
    clinical_reviewed_by: null,
    clinical_reviewed_at: null,
    timepoints: Object.freeze(timepoints),
  };
}

/**
 * The 15 CMS-aligned definitions and the 3 PennSync screening definitions.
 * @type {Readonly<Record<string, any>>}
 */
export const V2_DEFINITIONS = Object.freeze({
  // ---------------------------------------------------------------- M1100 --
  m1100_cms_e2: Object.freeze({
    definition_id: "m1100_cms_e2",
    item_number: "M1100",
    title: "Patient Living Situation",
    prompt:
      "Which of the following best describes the patient’s residential circumstance and "
      + "availability of assistance?",
    response_shape: "matrix_choice",
    ...cms("OASIS-E2 All-Item instrument, M1100 (Patient Living Situation)", ["SOC", "ROC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The legacy set printed codes 01–04 against cells CMS numbers differently: legacy "
      + "'01 lives alone, no assistance' is CMS 05, and legacy '03 lives with others, no "
      + "assistance' is CMS 10. Congregate living had no option at all.",
    // The published 3x5 grid. Rows are living arrangement; columns are
    // availability of assistance. Codes are the published cell labels.
    matrix: Object.freeze({
      row_header: "Living Arrangement",
      column_header: "Availability of Assistance",
      rows: Object.freeze([
        Object.freeze({ row_id: "A", label: "Patient lives alone" }),
        Object.freeze({ row_id: "B", label: "Patient lives with other person(s) in the home" }),
        Object.freeze({
          row_id: "C",
          label: "Patient lives in congregate situation (for example, assisted living, residential care home)",
        }),
      ]),
      columns: Object.freeze([
        Object.freeze({ column_id: "1", label: "Around the Clock" }),
        Object.freeze({ column_id: "2", label: "Regular Daytime" }),
        Object.freeze({ column_id: "3", label: "Regular Nighttime" }),
        Object.freeze({ column_id: "4", label: "Occasional/Short-Term Assistance" }),
        Object.freeze({ column_id: "5", label: "No Assistance Available" }),
      ]),
    }),
    codes: Object.freeze([
      Object.freeze({ code: "01", row_id: "A", column_id: "1", label: "Patient lives alone — Around the Clock" }),
      Object.freeze({ code: "02", row_id: "A", column_id: "2", label: "Patient lives alone — Regular Daytime" }),
      Object.freeze({ code: "03", row_id: "A", column_id: "3", label: "Patient lives alone — Regular Nighttime" }),
      Object.freeze({ code: "04", row_id: "A", column_id: "4", label: "Patient lives alone — Occasional/Short-Term Assistance" }),
      Object.freeze({ code: "05", row_id: "A", column_id: "5", label: "Patient lives alone — No Assistance Available" }),
      Object.freeze({ code: "06", row_id: "B", column_id: "1", label: "Patient lives with other person(s) in the home — Around the Clock" }),
      Object.freeze({ code: "07", row_id: "B", column_id: "2", label: "Patient lives with other person(s) in the home — Regular Daytime" }),
      Object.freeze({ code: "08", row_id: "B", column_id: "3", label: "Patient lives with other person(s) in the home — Regular Nighttime" }),
      Object.freeze({ code: "09", row_id: "B", column_id: "4", label: "Patient lives with other person(s) in the home — Occasional/Short-Term Assistance" }),
      Object.freeze({ code: "10", row_id: "B", column_id: "5", label: "Patient lives with other person(s) in the home — No Assistance Available" }),
      Object.freeze({ code: "11", row_id: "C", column_id: "1", label: "Patient lives in congregate situation — Around the Clock" }),
      Object.freeze({ code: "12", row_id: "C", column_id: "2", label: "Patient lives in congregate situation — Regular Daytime" }),
      Object.freeze({ code: "13", row_id: "C", column_id: "3", label: "Patient lives in congregate situation — Regular Nighttime" }),
      Object.freeze({ code: "14", row_id: "C", column_id: "4", label: "Patient lives in congregate situation — Occasional/Short-Term Assistance" }),
      Object.freeze({ code: "15", row_id: "C", column_id: "5", label: "Patient lives in congregate situation — No Assistance Available" }),
    ]),
  }),

  // ---------------------------------------------------------------- M1306 --
  m1306_cms_e2: Object.freeze({
    definition_id: "m1306_cms_e2",
    item_number: "M1306",
    title: "Unhealed Pressure Ulcer/Injury at Stage 2 or Higher",
    prompt:
      "Does this patient have at least one Unhealed Pressure Ulcer/Injury at Stage 2 or Higher "
      + "or designated as Unstageable? (Excludes Stage 1 pressure injuries and all healed "
      + "pressure ulcers/injuries)",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1306", ["SOC", "ROC", "FU", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The legacy prompt asked about a pressure ulcer 'at any stage', so a Stage 1 injury was "
      + "coded 1 in PennSync and 0 on the official assessment. CMS explicitly excludes Stage 1.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "No" }),
      Object.freeze({ code: "1", label: "Yes" }),
    ]),
  }),

  // ---------------------------------------------------------------- M1340 --
  m1340_cms_e2: Object.freeze({
    definition_id: "m1340_cms_e2",
    item_number: "M1340",
    title: "Surgical Wound",
    prompt: "Does this patient have a Surgical Wound?",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1340", ["SOC", "ROC", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The code set {0,1,2} matched but code 2 did not: CMS 2 is 'known but not observable due "
      + "to a non-removable dressing/device'. The legacy 2 meant 'infected/complications'. "
      + "Infection status is not part of M1340.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "No" }),
      Object.freeze({ code: "1", label: "Yes, patient has at least one observable surgical wound" }),
      Object.freeze({
        code: "2",
        label: "Surgical wound known but not observable due to non-removable dressing/device",
      }),
    ]),
  }),

  // ---------------------------------------------------------------- M1400 --
  m1400_cms_e2: Object.freeze({
    definition_id: "m1400_cms_e2",
    item_number: "M1400",
    title: "Short of Breath",
    prompt: "When is the patient dyspneic or noticeably Short of Breath?",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1400", ["SOC", "ROC", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "Legacy code 3 read 'with minimal exertion at rest', merging CMS 3 (minimal exertion or "
      + "agitation, which excludes rest) with CMS 4 (at rest). Legacy 3 and 4 were also not "
      + "distinguishable from each other.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "Patient is not short of breath" }),
      Object.freeze({ code: "1", label: "When walking more than 20 feet, climbing stairs" }),
      Object.freeze({
        code: "2",
        label:
          "With moderate exertion (for example, while dressing, using commode or bedpan, "
          + "walking distances less than 20 feet)",
      }),
      Object.freeze({
        code: "3",
        label:
          "With minimal exertion (for example, while eating, talking, or performing other ADLs) "
          + "or with agitation",
      }),
      Object.freeze({ code: "4", label: "At rest (during day or night)" }),
    ]),
  }),

  // ---------------------------------------------------------------- M1620 --
  m1620_cms_e2: Object.freeze({
    definition_id: "m1620_cms_e2",
    item_number: "M1620",
    title: "Bowel Incontinence Frequency",
    prompt: "Bowel Incontinence Frequency",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1620", ["SOC", "ROC", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "Legacy 4 merged CMS 4 (daily) with CMS 5 (more often than once daily), and legacy 5 "
      + "('patient has ostomy') is CMS NA, not a numbered code. CMS UK was absent entirely.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "Very rarely or never has bowel incontinence" }),
      Object.freeze({ code: "1", label: "Less than once weekly" }),
      Object.freeze({ code: "2", label: "One to three times weekly" }),
      Object.freeze({ code: "3", label: "Four to six times weekly" }),
      Object.freeze({ code: "4", label: "On a daily basis" }),
      Object.freeze({ code: "5", label: "More often than once daily" }),
      Object.freeze({ code: "NA", label: "Patient has ostomy for bowel elimination" }),
      // CMS: 'Omit "UK" option on DC'.
      Object.freeze({
        code: "UK",
        label: "Unknown",
        omitted_at_timepoints: Object.freeze(["DC"]),
      }),
    ]),
  }),

  // ---------------------------------------------------------------- M1740 --
  m1740_cms_e2: Object.freeze({
    definition_id: "m1740_cms_e2",
    item_number: "M1740",
    title: "Cognitive, Behavioral, and Psychiatric Symptoms",
    prompt:
      "Cognitive, Behavioral, and Psychiatric Symptoms that are demonstrated at least once a "
      + "week (Reported or Observed):",
    response_shape: "multi_select",
    ...cms("OASIS-E2 All-Item instrument, M1740", ["SOC", "ROC", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "CMS M1740 is check-all-that-apply with codes 1–7 where 7 is 'None of the above'. The "
      + "legacy item was single-select 0–4: code 0 is not a valid M1740 response at all, and "
      + "CMS 5 and 6 were missing.",
    codes: Object.freeze([
      Object.freeze({
        code: "1",
        label:
          "Memory deficit: failure to recognize familiar persons/places, inability to recall "
          + "events of past 24 hours, significant memory loss so that supervision is required",
      }),
      Object.freeze({
        code: "2",
        label:
          "Impaired decision-making: failure to perform usual ADLs or IADLs, inability to "
          + "appropriately stop activities, jeopardizes safety through actions",
      }),
      Object.freeze({
        code: "3",
        label: "Verbal disruption: yelling, threatening, excessive profanity, sexual references, etc.",
      }),
      Object.freeze({
        code: "4",
        label:
          "Physical aggression: aggressive or combative to self and others (for example, hits "
          + "self, throws objects, punches, dangerous maneuvers with wheelchair or other objects)",
      }),
      Object.freeze({
        code: "5",
        label: "Disruptive, infantile, or socially inappropriate behavior (excludes verbal actions)",
      }),
      Object.freeze({ code: "6", label: "Delusional, hallucinatory, or paranoid behavior" }),
      // The mutually exclusive "none" response.
      Object.freeze({ code: "7", label: "None of the above behaviors demonstrated", exclusive: true }),
    ]),
  }),

  // ---------------------------------------------------------------- M1830 --
  m1830_cms_e2: Object.freeze({
    definition_id: "m1830_cms_e2",
    item_number: "M1830",
    title: "Bathing",
    prompt:
      "Current ability to wash entire body safely. Excludes grooming (washing face, washing "
      + "hands, and shampooing hair).",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1830", ["SOC", "ROC", "FU", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The legacy set was a graduated person-assistance scale, not the CMS shower/tub scale. "
      + "Legacy 5 ('refused') and 6 ('unable to rate — artificial opening') are not M1830 "
      + "responses; CMS 6 is a valid totally-dependent response.",
    codes: Object.freeze([
      Object.freeze({
        code: "0",
        label: "Able to bathe self in shower or tub independently, including getting in and out of tub/shower.",
      }),
      Object.freeze({
        code: "1",
        label:
          "With the use of devices, is able to bathe self in shower or tub independently, "
          + "including getting in and out of the tub/shower.",
      }),
      Object.freeze({
        code: "2",
        label:
          "Able to bathe in shower or tub with the intermittent assistance of another person: "
          + "(a) for intermittent supervision or encouragement or reminders, OR (b) to get in and "
          + "out of the shower or tub, OR (c) for washing difficult to reach areas.",
      }),
      Object.freeze({
        code: "3",
        label:
          "Able to participate in bathing self in shower or tub, but requires presence of "
          + "another person throughout the bath for assistance or supervision.",
      }),
      Object.freeze({
        code: "4",
        label:
          "Unable to use the shower or tub, but able to bathe self independently with or "
          + "without the use of devices at the sink, in chair, or on commode.",
      }),
      Object.freeze({
        code: "5",
        label:
          "Unable to use the shower or tub, but able to participate in bathing self in bed, at "
          + "the sink, in bedside chair, or on commode, with the assistance or supervision of "
          + "another person.",
      }),
      Object.freeze({
        code: "6",
        label: "Unable to participate effectively in bathing and is bathed totally by another person.",
      }),
    ]),
  }),

  // ---------------------------------------------------------------- M1840 --
  m1840_cms_e2: Object.freeze({
    definition_id: "m1840_cms_e2",
    item_number: "M1840",
    title: "Toilet Transferring",
    prompt:
      "Current ability to get to and from the toilet or bedside commode safely and transfer on "
      + "and off toilet/commode.",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1840", ["SOC", "ROC", "FU", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "Legacy codes 2 and 3 used the bear-weight/pivot language of M1850 (Transferring). CMS "
      + "M1840 codes by WHERE the patient can toilet, not by how much help they need.",
    codes: Object.freeze([
      Object.freeze({
        code: "0",
        label: "Able to get to and from the toilet and transfer independently with or without a device.",
      }),
      Object.freeze({
        code: "1",
        label:
          "When reminded, assisted, or supervised by another person, able to get to and from "
          + "the toilet and transfer.",
      }),
      Object.freeze({
        code: "2",
        label:
          "Unable to get to and from the toilet but is able to use a bedside commode (with or "
          + "without assistance).",
      }),
      Object.freeze({
        code: "3",
        label:
          "Unable to get to and from the toilet or bedside commode but is able to use a "
          + "bedpan/urinal independently.",
      }),
      Object.freeze({ code: "4", label: "Is totally dependent in toileting." }),
    ]),
  }),

  // ---------------------------------------------------------------- M1860 --
  m1860_cms_e2: Object.freeze({
    definition_id: "m1860_cms_e2",
    item_number: "M1860",
    title: "Ambulation/Locomotion",
    prompt:
      "Current ability to walk safely, once in a standing position, or use a wheelchair, once "
      + "in a seated position, on a variety of surfaces.",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1860", ["SOC", "ROC", "FU", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "PennSync inserted a '1 — with minor difficulty on uneven surfaces' level that is not a "
      + "CMS response, offsetting every later code by one. That inserted level is removed here.",
    codes: Object.freeze([
      Object.freeze({
        code: "0",
        label:
          "Able to independently walk on even and uneven surfaces and negotiate stairs with or "
          + "without railings (specifically: needs no human assistance or assistive device).",
      }),
      Object.freeze({
        code: "1",
        label:
          "With the use of a one-handed device (for example, cane, single crutch, hemi-walker), "
          + "able to independently walk on even and uneven surfaces and negotiate stairs with or "
          + "without railings.",
      }),
      Object.freeze({
        code: "2",
        label:
          "Requires use of a two-handed device (for example, walker or crutches) to walk alone "
          + "on a level surface and/or requires human supervision or assistance to negotiate "
          + "stairs or steps or uneven surfaces.",
      }),
      Object.freeze({ code: "3", label: "Able to walk only with the supervision or assistance of another person at all times." }),
      Object.freeze({ code: "4", label: "Chairfast, unable to ambulate but is able to wheel self independently." }),
      Object.freeze({ code: "5", label: "Chairfast, unable to ambulate and is unable to wheel self." }),
      Object.freeze({ code: "6", label: "Bedfast, unable to ambulate or be up in a chair." }),
    ]),
  }),

  // ---------------------------------------------------------------- M1870 --
  m1870_cms_e2: Object.freeze({
    definition_id: "m1870_cms_e2",
    item_number: "M1870",
    title: "Feeding or Eating",
    prompt:
      "Current ability to feed self meals and snacks safely. Note: This refers only to the "
      + "process of eating, chewing, and swallowing, not preparing the food to be eaten.",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M1870", ["SOC", "ROC", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "Legacy 3 was 'totally dependent on another person'; CMS 3 is oral intake PLUS "
      + "supplemental tube feeding. CMS 4 and 5 were absent, so a tube-fed patient could not be "
      + "coded at all.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "Able to independently feed self" }),
      Object.freeze({
        code: "1",
        label:
          "Able to feed self independently but requires: (a) meal set-up; OR (b) intermittent "
          + "assistance or supervision from another person; OR (c) a liquid, pureed, or ground "
          + "meat diet.",
      }),
      Object.freeze({ code: "2", label: "Unable to feed self and must be assisted or supervised throughout the meal/snack." }),
      Object.freeze({
        code: "3",
        label:
          "Able to take in nutrients orally and receives supplemental nutrients through a "
          + "nasogastric tube or gastrostomy.",
      }),
      Object.freeze({
        code: "4",
        label: "Unable to take in nutrients orally and is fed nutrients through a nasogastric tube or gastrostomy.",
      }),
      Object.freeze({ code: "5", label: "Unable to take in nutrients orally or by tube feeding." }),
    ]),
  }),

  // ---------------------------------------------------------------- M2001 --
  m2001_cms_e2: Object.freeze({
    definition_id: "m2001_cms_e2",
    item_number: "M2001",
    title: "Drug Regimen Review",
    prompt:
      "Did a complete drug regimen review identify potential clinically significant medication "
      + "issues?",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M2001", ["SOC", "ROC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The legacy item merged M2003 (Medication Follow-up) into M2001 by splitting 'issues "
      + "found' on whether the physician was contacted. Legacy code 2 is not a valid M2001 "
      + "response and CMS code 9 was absent. M2003 is a separate item and is NOT implemented here.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "No — No issues found during review" }),
      Object.freeze({ code: "1", label: "Yes — Issues found during review" }),
      Object.freeze({ code: "9", label: "NA — Patient is not taking any medications" }),
    ]),
  }),

  // ---------------------------------------------------------------- M2010 --
  m2010_cms_e2: Object.freeze({
    definition_id: "m2010_cms_e2",
    item_number: "M2010",
    title: "Patient/Caregiver High-Risk Drug Education",
    prompt:
      "Has the patient/caregiver received instruction on special precautions for all high-risk "
      + "medications (such as hypoglycemics, anticoagulants, etc.) and how and when to report "
      + "problems that may occur?",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M2010", ["SOC", "ROC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The legacy codes inverted against CMS: legacy 0 ('not applicable — no high-risk drugs') "
      + "is CMS NA, while CMS 0 is 'No'. Entering the legacy 0 as an M2010 response would record "
      + "that education was NOT provided.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "No" }),
      Object.freeze({ code: "1", label: "Yes" }),
      Object.freeze({
        code: "NA",
        label:
          "Patient not taking any high-risk drugs OR patient/caregiver fully knowledgeable about "
          + "special precautions associated with all high-risk medications",
      }),
    ]),
  }),

  // ---------------------------------------------------------------- M2020 --
  m2020_cms_e2: Object.freeze({
    definition_id: "m2020_cms_e2",
    item_number: "M2020",
    title: "Management of Oral Medications",
    prompt:
      "Patient’s current ability to prepare and take all oral medications reliably and safely, "
      + "including administration of the correct dosage at the appropriate times/intervals. "
      + "Excludes injectable and IV medications. (NOTE: This refers to ability, not compliance "
      + "or willingness.)",
    response_shape: "single",
    ...cms("OASIS-E2 All-Item instrument, M2020", ["SOC", "ROC", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "Legacy codes 1 and 2 were transposed against CMS, and CMS NA (no oral medications "
      + "prescribed) was absent.",
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "Able to independently take the correct oral medication(s) and proper dosage(s) at the correct times." }),
      Object.freeze({
        code: "1",
        label:
          "Able to take medication(s) at the correct times if: (a) individual dosages are "
          + "prepared in advance by another person; OR (b) another person develops a drug diary "
          + "or chart.",
      }),
      Object.freeze({
        code: "2",
        label: "Able to take medication(s) at the correct times if given reminders by another person at the appropriate times",
      }),
      Object.freeze({ code: "3", label: "Unable to take medication unless administered by another person." }),
      Object.freeze({ code: "NA", label: "No oral medications prescribed." }),
    ]),
  }),

  // ---------------------------------------------------------------- M2401 --
  m2401_cms_e2: Object.freeze({
    definition_id: "m2401_cms_e2",
    item_number: "M2401",
    title: "Intervention Synopsis",
    prompt:
      "At the time of or at any time since the most recent SOC/ROC assessment, were the "
      + "following interventions BOTH included in the physician-ordered plan of care AND "
      + "implemented? (Mark only one box in each row.)",
    response_shape: "grid",
    ...cms("OASIS-E2 All-Item instrument, M2401 (rows b–f)", ["TRN", "DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The legacy item asked a single question about MEDICATION interventions, which is M2003/"
      + "M2005, not M2401. CMS M2401 is a multi-row grid, each row coded 0/1/NA.",
    rows: Object.freeze([
      Object.freeze({ row_id: "b", label: "Falls prevention interventions" }),
      Object.freeze({
        row_id: "c",
        label:
          "Depression intervention(s) such as medication, referral for other treatment, or a "
          + "monitoring plan for current treatment",
      }),
      Object.freeze({ row_id: "d", label: "Intervention(s) to monitor and mitigate pain" }),
      Object.freeze({ row_id: "e", label: "Intervention(s) to prevent pressure ulcers" }),
      Object.freeze({ row_id: "f", label: "Pressure ulcer treatment based on principles of moist wound healing" }),
    ]),
    codes: Object.freeze([
      Object.freeze({ code: "0", label: "No" }),
      Object.freeze({ code: "1", label: "Yes" }),
      Object.freeze({ code: "NA", label: "Not Applicable" }),
    ]),
  }),

  // ---------------------------------------------------------------- M2420 --
  m2420_cms_e2: Object.freeze({
    definition_id: "m2420_cms_e2",
    item_number: "M2420",
    title: "Discharge Disposition",
    prompt: "Where is the patient after discharge from your agency? (Choose only one answer.)",
    response_shape: "single",
    // Agency discharge ONLY. An inpatient-facility transfer is M2410, which
    // PennSync does not implement — see `registry.js` UNIMPLEMENTED_ITEMS.
    ...cms("OASIS-E2 All-Item instrument, M2420", ["DC"]),
    migration_disposition: "align_to_cms",
    migration_rationale:
      "The legacy list was the pre-OASIS-D disposition set: its 2, 3 and 4 named hospital, "
      + "rehab and nursing home. Under the current instrument those codes name community and "
      + "hospice destinations, and legacy 5 is not a valid response. M2420 never represents an "
      + "inpatient-facility transfer.",
    codes: Object.freeze([
      Object.freeze({
        code: "1",
        label:
          "Patient remained in the community (without skilled services from a Medicare "
          + "Certified HHA or non-institutional hospice)",
      }),
      Object.freeze({
        code: "2",
        label: "Patient remained in the community (with skilled services from a Medicare Certified HHA)",
      }),
      Object.freeze({ code: "3", label: "Patient transferred to a non-institutional hospice" }),
      Object.freeze({
        code: "4",
        label: "Unknown because patient moved to a geographic location not served by this agency",
      }),
      Object.freeze({ code: "UK", label: "Other unknown" }),
    ]),
  }),

  // ================= PennSync screening prompts (NOT OASIS items) ==========
  // These three keep a genuinely useful clinical screen that the legacy set had
  // mis-attached to an M-number. They carry NO item number, are never CMS
  // output, and never count toward OASIS completion.
  ps_hospitalization_risk_tier: Object.freeze({
    definition_id: "ps_hospitalization_risk_tier",
    item_number: null,
    title: "Hospitalization risk tier",
    prompt: "Which best describes the overall risk for hospitalization for this patient?",
    response_shape: "single",
    item_source: "pennsync_screening",
    item_spec_version: null,
    source_id: null,
    citation: "PennSync internal screening prompt — not a CMS item.",
    source_verification: "not_a_cms_item",
    source_verified_at: V2_DERIVATION.derived_at,
    clinical_review: "pending_named_sme_review",
    clinical_reviewed_by: null,
    clinical_reviewed_at: null,
    timepoints: Object.freeze(["SOC", "ROC", "FU", "TRN", "DC"]),
    migration_disposition: "pennsync_only_screening",
    migration_rationale:
      "The legacy prompt was a three-tier risk rating carrying the number M1033. Real M1033 is "
      + "check-all-that-apply across ten named risk factors, so no legacy answer maps to a valid "
      + "M1033 response. The tier is clinically useful, so it is kept under a non-M identifier. "
      + "It must never feed official M1033 or PDGM.",
    codes: Object.freeze([
      Object.freeze({ code: "low", label: "Low risk" }),
      Object.freeze({ code: "medium", label: "Medium risk" }),
      Object.freeze({ code: "high", label: "High risk" }),
    ]),
  }),
  ps_urinary_incontinence_frequency: Object.freeze({
    definition_id: "ps_urinary_incontinence_frequency",
    item_number: null,
    title: "Urinary incontinence frequency screen",
    prompt: "How often does the patient have urinary incontinence (loss of bladder control)?",
    response_shape: "single",
    item_source: "pennsync_screening",
    item_spec_version: null,
    source_id: null,
    citation: "PennSync internal screening prompt — not a CMS item.",
    source_verification: "not_a_cms_item",
    source_verified_at: V2_DERIVATION.derived_at,
    clinical_review: "pending_named_sme_review",
    clinical_reviewed_by: null,
    clinical_reviewed_at: null,
    timepoints: Object.freeze(["SOC", "ROC", "FU", "TRN", "DC"]),
    migration_disposition: "pennsync_only_screening",
    migration_rationale:
      "The legacy prompt was a frequency-graded incontinence scale carrying the number M1610. "
      + "Real M1610 has three responses (0 none, 1 incontinent, 2 requires a catheter), so the "
      + "legacy 2 ('daily pads required') meant incontinence where CMS 2 means a catheter. The "
      + "frequency screen is kept under a non-M identifier.",
    codes: Object.freeze([
      Object.freeze({ code: "none", label: "No incontinence" }),
      Object.freeze({ code: "occasional_stress", label: "Occasional stress incontinence" }),
      Object.freeze({ code: "daily_pads", label: "During day/night; daily pads required" }),
      Object.freeze({ code: "continuous", label: "All the time; no control" }),
      Object.freeze({ code: "catheter", label: "Patient has indwelling/suprapubic catheter" }),
    ]),
  }),
  ps_ostomy_self_management: Object.freeze({
    definition_id: "ps_ostomy_self_management",
    item_number: null,
    title: "Ostomy self-management screen",
    prompt: "Does the patient have a surgically created ostomy for elimination, and how is it managed?",
    response_shape: "single",
    item_source: "pennsync_screening",
    item_spec_version: null,
    source_id: null,
    citation: "PennSync internal screening prompt — not a CMS item.",
    source_verification: "not_a_cms_item",
    source_verified_at: V2_DERIVATION.derived_at,
    clinical_review: "pending_named_sme_review",
    clinical_reviewed_by: null,
    clinical_reviewed_at: null,
    timepoints: Object.freeze(["SOC", "ROC", "FU", "TRN", "DC"]),
    migration_disposition: "pennsync_only_screening",
    migration_rationale:
      "The legacy prompt coded the patient's independence with an ostomy under the number "
      + "M1630. Real M1630 codes whether the ostomy related to an inpatient stay or necessitated "
      + "a regimen change in the last 14 days — a different question. The self-management screen "
      + "is kept under a non-M identifier.",
    codes: Object.freeze([
      Object.freeze({ code: "none", label: "No ostomy for elimination" }),
      Object.freeze({ code: "independent", label: "Patient has ostomy and is managing independently" }),
      Object.freeze({ code: "needs_assistance", label: "Patient has ostomy and requires assistance" }),
    ]),
  }),
});

/** The 15 CMS-aligned definition ids. */
export const V2_CMS_DEFINITION_IDS = Object.freeze(
  Object.values(V2_DEFINITIONS).filter((d) => d.item_source === "cms_item").map((d) => d.definition_id).sort(),
);

/** The 3 PennSync screening definition ids. */
export const V2_SCREENING_DEFINITION_IDS = Object.freeze(
  Object.values(V2_DEFINITIONS).filter((d) => d.item_source === "pennsync_screening").map((d) => d.definition_id).sort(),
);
