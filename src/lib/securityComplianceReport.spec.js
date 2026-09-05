import { describe, expect, it } from "vitest";
import {
  buildSecurityComplianceReport,
  serializeAssessedSecurityChecks,
} from "./securityComplianceReport";

describe("security compliance report", () => {
  const checks = [
    {
      name: "Platform control",
      status: "attested",
      attested: true,
      evidenceType: "platform_attestation",
      icon: () => null,
    },
    {
      name: "Audit Trails",
      status: "attention",
      attested: false,
      evidenceType: "application_assessment",
      icon: () => null,
    },
  ];

  it("serializes the assessed evidence classification without UI components", () => {
    expect(serializeAssessedSecurityChecks(checks)).toEqual([
      {
        name: "Platform control",
        status: "attested",
        attested: true,
        evidenceType: "platform_attestation",
      },
      {
        name: "Audit Trails",
        status: "attention",
        attested: false,
        evidenceType: "application_assessment",
      },
    ]);
  });

  it("exports unavailable histories as null, never as zero", () => {
    expect(buildSecurityComplianceReport({
      generatedDate: "2026-09-05T00:00:00.000Z",
      complianceScore: 0,
      assessedChecks: checks,
    })).toMatchObject({
      schemaVersion: 2,
      userActivityEvents: null,
      userActivityHistory: "unavailable_pending_tenant_authorized_provenance",
      criticalSecurityEvents: null,
      phiAccessSecurityEvents: null,
      checks: [
        { name: "Platform control", status: "attested", attested: true },
        { name: "Audit Trails", status: "attention", attested: false },
      ],
    });
  });
});
