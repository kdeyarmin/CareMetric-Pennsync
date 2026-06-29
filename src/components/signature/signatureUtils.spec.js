import { describe, it, expect, vi } from "vitest";

// The module imports the Base44 client (for the remote-verify helper). Stub it
// so importing the pure helpers under test has no SDK/env side effects.
vi.mock("@/api/base44Client", () => ({
  base44: { functions: { invoke: vi.fn() } },
}));

import {
  getDocumentDisplayName,
  getSignatureDueDate,
  getSignatureSignedAt,
  getSignerProgress,
  getNormalizedSignatureStatus,
  getSignatureStatusLabel,
  isSignatureOverdue,
} from "./signatureUtils.js";

const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

describe("getDocumentDisplayName", () => {
  it("prefers document_name, then falls through the alias chain", () => {
    expect(getDocumentDisplayName({ document_name: "A", document_title: "B" })).toBe("A");
    expect(getDocumentDisplayName({ document_title: "B", template_name: "C" })).toBe("B");
    expect(getDocumentDisplayName({ template_name: "C" })).toBe("C");
    expect(getDocumentDisplayName({ packet_name: "D" })).toBe("D");
    expect(getDocumentDisplayName({ document_type: "E" })).toBe("E");
  });

  it("falls back to 'Document' for empty/missing input", () => {
    expect(getDocumentDisplayName({})).toBe("Document");
    expect(getDocumentDisplayName(null)).toBe("Document");
    expect(getDocumentDisplayName(undefined)).toBe("Document");
  });
});

describe("getSignatureDueDate / getSignatureSignedAt", () => {
  it("reads due date from due_date then expires_at", () => {
    expect(getSignatureDueDate({ due_date: "d", expires_at: "e" })).toBe("d");
    expect(getSignatureDueDate({ expires_at: "e" })).toBe("e");
    expect(getSignatureDueDate({})).toBeNull();
  });

  it("reads signed-at from signed_at, then signed_date, then completed_date", () => {
    expect(getSignatureSignedAt({ signed_at: "a", signed_date: "b" })).toBe("a");
    expect(getSignatureSignedAt({ signed_date: "b" })).toBe("b");
    expect(getSignatureSignedAt({ completed_date: "c" })).toBe("c");
    expect(getSignatureSignedAt({})).toBeNull();
  });
});

describe("getSignerProgress", () => {
  it("returns zeros for a record with no signers", () => {
    expect(getSignerProgress({})).toEqual({
      totalSigners: 0,
      requiredSigners: 0,
      signedRequiredCount: 0,
      allRequiredSigned: false,
    });
  });

  it("counts a required signer as signed via signature, signed_date, or is_signed", () => {
    const record = {
      signers: [
        { id: "1", signature: "ink" },
        { id: "2", signed_date: PAST },
        { id: "3", is_signed: true },
        { id: "4" }, // required (undefined !== false) but unsigned
      ],
    };
    const p = getSignerProgress(record);
    expect(p.totalSigners).toBe(4);
    expect(p.requiredSigners).toBe(4);
    expect(p.signedRequiredCount).toBe(3);
    expect(p.allRequiredSigned).toBe(false);
  });

  it("excludes optional signers (required === false) from the required tally", () => {
    const record = {
      signers: [
        { id: "1", required: true, signature: "ink" },
        { id: "2", required: false }, // optional, unsigned — ignored
      ],
    };
    const p = getSignerProgress(record);
    expect(p.totalSigners).toBe(2);
    expect(p.requiredSigners).toBe(1);
    expect(p.signedRequiredCount).toBe(1);
    expect(p.allRequiredSigned).toBe(true);
  });

  it("falls back to required_signatures when signers is absent", () => {
    const record = {
      required_signatures: [
        { signer_id: "a", is_required: true, signature: "ink" },
        { id: "b", is_required: true }, // unsigned
        { id: "c", is_required: false }, // optional
      ],
    };
    const p = getSignerProgress(record);
    expect(p.totalSigners).toBe(3);
    expect(p.requiredSigners).toBe(2);
    expect(p.signedRequiredCount).toBe(1);
    expect(p.allRequiredSigned).toBe(false);
  });
});

describe("getNormalizedSignatureStatus", () => {
  it("maps 'signed' and 'completed' to 'signed'", () => {
    expect(getNormalizedSignatureStatus({ status: "signed" })).toBe("signed");
    expect(getNormalizedSignatureStatus({ status: "completed" })).toBe("signed");
  });

  it("maps 'rejected' to 'declined' and passes through declined/expired", () => {
    expect(getNormalizedSignatureStatus({ status: "rejected" })).toBe("declined");
    expect(getNormalizedSignatureStatus({ status: "declined" })).toBe("declined");
    expect(getNormalizedSignatureStatus({ status: "expired" })).toBe("expired");
  });

  it("infers 'signed' from signature_data plus a signed-at timestamp", () => {
    expect(getNormalizedSignatureStatus({ signature_data: "ink", signed_at: PAST })).toBe("signed");
    // signature_data without a timestamp does not infer signed
    expect(getNormalizedSignatureStatus({ signature_data: "ink" })).toBe("pending");
  });

  it("infers 'signed' when all required signers have signed", () => {
    expect(
      getNormalizedSignatureStatus({ signers: [{ id: "1", required: true, signature: "ink" }] }),
    ).toBe("signed");
  });

  it("falls back to the explicit status or 'pending'", () => {
    expect(getNormalizedSignatureStatus({ status: "in_progress" })).toBe("in_progress");
    expect(getNormalizedSignatureStatus({})).toBe("pending");
  });
});

describe("getSignatureStatusLabel", () => {
  it("labels both raw status strings and full records", () => {
    expect(getSignatureStatusLabel("signed")).toBe("Signed");
    expect(getSignatureStatusLabel("declined")).toBe("Declined");
    expect(getSignatureStatusLabel("expired")).toBe("Expired");
    expect(getSignatureStatusLabel("in_progress")).toBe("In Progress");
    expect(getSignatureStatusLabel("anything-else")).toBe("Pending");
    expect(getSignatureStatusLabel({ status: "completed" })).toBe("Signed");
  });
});

describe("isSignatureOverdue", () => {
  it("is overdue when a past due date exists and the doc is not finalized", () => {
    expect(isSignatureOverdue({ due_date: PAST, status: "pending" })).toBe(true);
  });

  it("is not overdue when signed, declined, or expired", () => {
    expect(isSignatureOverdue({ due_date: PAST, status: "completed" })).toBe(false);
    expect(isSignatureOverdue({ due_date: PAST, status: "rejected" })).toBe(false);
    expect(isSignatureOverdue({ due_date: PAST, status: "expired" })).toBe(false);
  });

  it("is not overdue when the due date is in the future or absent", () => {
    expect(isSignatureOverdue({ due_date: FUTURE, status: "pending" })).toBe(false);
    expect(isSignatureOverdue({ status: "pending" })).toBe(false);
  });
});
