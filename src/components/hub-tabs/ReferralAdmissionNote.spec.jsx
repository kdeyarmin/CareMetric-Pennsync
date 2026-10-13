import { describe, it, expect } from "vitest";
import { buildAdmissionRoughNote } from "./ReferralAdmissionNote.jsx";

describe("buildAdmissionRoughNote", () => {
  it("omits clinical filler when the referral stated nothing", () => {
    const note = buildAdmissionRoughNote({});
    expect(note).toContain("ADMISSION NOTE - From Referral");
    expect(note).not.toMatch(/None documented/i);
    expect(note).not.toMatch(/Not assessed/i);
    expect(note).not.toMatch(/None noted/i);
    expect(note).not.toMatch(/To be determined/i);
    expect(note).not.toMatch(/NKDA/i);
    expect(note).not.toMatch(/^ALLERGIES:/m);
    expect(note).not.toMatch(/^FUNCTIONAL STATUS:/m);
    expect(note).not.toMatch(/^SAFETY CONCERNS:/m);
  });

  it("includes only stated clinical facts", () => {
    const note = buildAdmissionRoughNote({
      demographics: { full_name: "Ada Lovelace", date_of_birth: "1815-12-10" },
      diagnoses: { primary_diagnosis: "CHF", allergies: "Penicillin" },
      functional_status: { fall_risk: "High" },
      safety_concerns: { high_risk_conditions: ["Fall risk", "Oxygen"] },
      skilled_needs: { services_ordered: ["SN"], goals_of_care: "Stabilize CHF" },
    });
    expect(note).toContain("Ada Lovelace");
    expect(note).toContain("ALLERGIES:\nPenicillin");
    expect(note).toContain("Fall Risk: High");
    expect(note).toContain("SAFETY CONCERNS:\nFall risk, Oxygen");
    expect(note).toContain("Services Ordered: SN");
    expect(note).not.toMatch(/Not assessed/i);
    expect(note).not.toMatch(/None documented/i);
  });
});
