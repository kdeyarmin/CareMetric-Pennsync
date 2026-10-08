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
      schemaVersion: 3,
      userActivityEvents: null,
      userActivityHistory: "unavailable",
      securityEventHistory: "unavailable",
      criticalSecurityEvents: null,
      phiAccessSecurityEvents: null,
      checks: [
        { name: "Platform control", status: "attested", attested: true },
        { name: "Audit Trails", status: "attention", attested: false },
      ],
    });
  });

  it("exports measured log metrics when the logs were read", () => {
    expect(buildSecurityComplianceReport({
      generatedDate: "2026-10-08T00:00:00.000Z",
      complianceScore: 100,
      assessedChecks: checks,
      logMetrics: { userActivityEvents: 12, criticalEvents: 2, phiAccess: 5 },
    })).toMatchObject({
      userActivityEvents: 12,
      userActivityHistory: "loaded",
      securityEventHistory: "loaded",
      criticalSecurityEvents: 2,
      phiAccessSecurityEvents: 5,
    });
  });
});
