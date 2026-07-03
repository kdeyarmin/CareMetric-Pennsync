import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReferralAgingBoard from "./ReferralAgingBoard";

// Fixed "today" so bucket math is deterministic regardless of when tests run.
const AS_OF = "2026-07-03";

const referrals = [
  // age 0 → on_track
  { id: "a", patient_name: "Alice OnTrack", referral_date: "2026-07-03", status: "new" },
  // age 2 (== TIMELY_INITIATION_DAYS) → due_soon
  { id: "b", patient_name: "Bob DueSoon", referral_date: "2026-07-01", status: "processing" },
  // age 13 → overdue
  { id: "c", patient_name: "Carol Overdue", referral_date: "2026-06-20", status: "ready_for_admission" },
  // SOC recorded → completed, never on the aging board
  { id: "d", patient_name: "Dana Done", referral_date: "2026-06-01", soc_date: "2026-06-02", status: "soc_completed" },
  // Declined → clock closed, never on the aging board
  { id: "e", patient_name: "Evan Declined", referral_date: "2026-06-01", status: "declined" },
];

describe("ReferralAgingBoard", () => {
  it("buckets open referrals into on-track / due-soon / overdue and hides closed ones", () => {
    render(<ReferralAgingBoard referrals={referrals} asOf={AS_OF} />);

    expect(screen.getByText(/Referral Aging — Intake to Start of Care/i)).toBeInTheDocument();
    expect(screen.getByText("3 open")).toBeInTheDocument();

    expect(screen.getByText("Alice OnTrack")).toBeInTheDocument();
    expect(screen.getByText("Bob DueSoon")).toBeInTheDocument();
    expect(screen.getByText("Carol Overdue")).toBeInTheDocument();

    // Completed / declined referrals are off the board entirely.
    expect(screen.queryByText("Dana Done")).not.toBeInTheDocument();
    expect(screen.queryByText("Evan Declined")).not.toBeInTheDocument();

    // Ages render against the fixed asOf date; oldest open age is surfaced.
    expect(screen.getByText("13d")).toBeInTheDocument();
    expect(screen.getByText(/oldest: 13d/i)).toBeInTheDocument();
  });

  it("renders an empty state when nothing is waiting on start of care", () => {
    render(
      <ReferralAgingBoard
        referrals={[{ id: "d", patient_name: "Dana Done", referral_date: "2026-06-01", soc_date: "2026-06-02", status: "soc_completed" }]}
        asOf={AS_OF}
      />
    );
    expect(screen.getByText(/No open referrals waiting on start of care/i)).toBeInTheDocument();
  });

  it("compact variant shows bucket counts and the needs-attention list (overdue first)", () => {
    render(<ReferralAgingBoard referrals={referrals} asOf={AS_OF} compact />);

    expect(screen.getByText(/Referral aging/i)).toBeInTheDocument();
    expect(screen.getByText(/1 on track/i)).toBeInTheDocument();
    expect(screen.getByText(/1 due soon/i)).toBeInTheDocument();
    expect(screen.getByText(/1 overdue/i)).toBeInTheDocument();

    // Overdue + due-soon entries need attention; on-track ones stay off the compact list.
    expect(screen.getByText("Carol Overdue")).toBeInTheDocument();
    expect(screen.getByText("Bob DueSoon")).toBeInTheDocument();
    expect(screen.queryByText("Alice OnTrack")).not.toBeInTheDocument();
  });
});
