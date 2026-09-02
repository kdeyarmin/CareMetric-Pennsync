import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { invoke, sendEmail, uploadFile } = vi.hoisted(() => ({
  invoke: vi.fn(),
  sendEmail: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    functions: { invoke },
    integrations: { Core: { SendEmail: sendEmail, UploadFile: uploadFile } },
  },
}));

import ClinicalManagerBriefCard from "@/components/referral/ClinicalManagerBriefCard";

describe("ClinicalManagerBriefCard containment", () => {
  it("shows the reimbursement brief as unavailable and performs no side effects", () => {
    render(<ClinicalManagerBriefCard referralData={{ totalPayment: 999999 }} />);

    expect(screen.getByText(/reimbursement\/coding brief is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/not re-sequenced for higher payment/i)).toBeInTheDocument();
    expect(screen.getByText(/official EMR\/CMS-approved grouper/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(screen.queryByText(/\$999,999/)).not.toBeInTheDocument();
  });
});
