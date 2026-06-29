// Single source of truth for what counts as a "state reportable" event and how a
// general incident maps onto a state-reportable category. Used by the smart
// incident form to decide when to show the supervisor banner and route the
// submission through submitStateReportableIncident (PDF + admin email + alert).

// The official state-reportable event categories (mirrors the legacy
// StateReportableForm list). These are always state-reportable.
export const STATE_REPORTABLE_EVENT_TYPES = [
  "Complaint of patient abuse - confirmed or not",
  "Death due to injury, suicide, or unusual circumstances",
  "Death due to malnutrition, dehydration or sepsis",
  "Death due to a medication error or adverse reaction to meds",
  "Health Department Reportable Diseases",
  "Misappropriation of patient property",
  "Patient Neglect",
  "Rape",
  "Transfer or admission to hospital because of injury or accident",
];

// General incident types offered in the quick/guided flow.
export const INCIDENT_TYPES = [
  { value: "wound_concern", label: "Wound concern" },
  { value: "pressure_injury", label: "Pressure injury" },
  { value: "fall", label: "Fall" },
  { value: "hospitalized", label: "Hospitalization / ER transfer" },
  { value: "medication_error", label: "Medication error" },
  { value: "safety_event", label: "Safety event" },
  { value: "behavioral_change", label: "Behavioral change" },
  { value: "infection_suspected", label: "Suspected infection" },
  { value: "abuse_suspected", label: "Suspected abuse / neglect" },
  { value: "death", label: "Patient death" },
  { value: "other", label: "Other" },
];

// Maps a general incident type to a suggested state-reportable category when the
// event is (or may be) legally reportable. Types not present here are not, by
// themselves, state-reportable.
const TYPE_TO_STATE_CATEGORY = {
  hospitalized: "Transfer or admission to hospital because of injury or accident",
  abuse_suspected: "Patient Neglect",
  death: "Death due to injury, suicide, or unusual circumstances",
  infection_suspected: "Health Department Reportable Diseases",
};

// Returns the suggested state-reportable category for a general incident type,
// or null if the type is not inherently state-reportable.
export function getStateReportableCategory(incidentType) {
  return TYPE_TO_STATE_CATEGORY[incidentType] || null;
}

// True when a general incident type should trigger the state-reportable pathway.
export function isStateReportableType(incidentType) {
  return !!TYPE_TO_STATE_CATEGORY[incidentType];
}