import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";
import EmrHandoffPanel from "./EmrHandoffPanel";
import { buildReviewAcknowledgement } from "./emrHandoff";

const NOTE = [
  "Assessment:",
  "Patient homebound due to COPD; requires a walker and one-person assist.",
  "",
  "Interventions:",
  "Dressing change performed to the right heel wound.",
].join("\n");

// userEvent.setup() installs its own navigator.clipboard stub, so every test
// installs its mock AFTER setup — otherwise userEvent silently replaces it and
// the assertion watches a spy the component never calls.
function mockClipboard(impl) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: impl },
    configurable: true,
    writable: true,
  });
}

describe("EmrHandoffPanel — moving prepared documentation into the EMR", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always shows the scope disclaimer without needing a disclosure", () => {
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} />);
    expect(
      screen.getByText(/PennSync assists with documentation preparation/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/enter\/sign the official documentation/i)).toBeInTheDocument();
  });

  it("never claims the note is Medicare compliant", () => {
    const { container } = renderWithProviders(<EmrHandoffPanel noteText={NOTE} />);
    expect(container.textContent).not.toMatch(/medicare[- ]compliant/i);
    expect(container.textContent).not.toMatch(/guaranteed/i);
  });

  it("marks the text as an AI-assisted draft so it stays distinct from confirmed content", () => {
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} aiAssisted nurseEdited />);
    expect(screen.getByText(/AI-assisted draft/i)).toBeInTheDocument();
    expect(screen.getByText(/Edited by you/i)).toBeInTheDocument();
  });

  it("copies the whole note without asserting the EMR step happened", async () => {
    // A clipboard write is not evidence the nurse switched apps, pasted, or that
    // the paste worked. Auto-reporting `copied_to_emr` would let Documentation
    // Readiness treat the visit as handed off on a button press alone.
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    const onReportStatus = vi.fn();
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} onReportStatus={onReportStatus} />);

    await user.click(screen.getByRole("button", { name: /copy to emr/i }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(NOTE));
    expect(onReportStatus).not.toHaveBeenCalled();
    expect(await screen.findByText(/paste into your EMR/i)).toBeInTheDocument();
    expect(screen.getByText(/will not assume the step happened/i)).toBeInTheDocument();
  });

  it("clears the Copied badge once the note is edited", async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    const { rerender } = renderWithProviders(<EmrHandoffPanel noteText={NOTE} />);

    await user.click(screen.getByRole("button", { name: /copy to emr/i }));
    expect(await screen.findByText(/paste into your EMR/i)).toBeInTheDocument();

    // The clipboard now holds the OLD text; a lingering green tick would tell
    // the nurse the wrong thing at the moment it matters most.
    rerender(<EmrHandoffPanel noteText={`${NOTE}\nAdded a line.`} />);
    expect(screen.queryByText(/paste into your EMR/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy to emr/i })).toBeInTheDocument();
  });

  it("shows an inline recovery path when the clipboard fails, and does not claim it copied", async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const onReportStatus = vi.fn();
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} onReportStatus={onReportStatus} />);

    await user.click(screen.getByRole("button", { name: /copy to emr/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/copy it\s+manually/i);
    expect(alert).toHaveTextContent(/nothing was lost/i);
    expect(onReportStatus).not.toHaveBeenCalled();
    expect(screen.queryByText(/paste into your EMR/i)).not.toBeInTheDocument();
  });

  it("offers per-section copy for EMRs that take a form rather than one box", async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} />);

    await user.click(screen.getByRole("button", { name: /copy one section at a time/i }));
    const sectionButtons = screen.getAllByRole("button", { name: /^copy$/i });
    expect(sectionButtons).toHaveLength(2);

    await user.click(sectionButtons[1]);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Interventions:\nDressing change performed to the right heel wound.",
      ),
    );
  });

  it("labels every handoff step as self-reported and never verified", () => {
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} onReportStatus={vi.fn()} />);
    expect(screen.getByText(/Self-reported by the nurse/i)).toBeInTheDocument();
    expect(screen.getByText(/did not verify/i)).toBeInTheDocument();
  });

  it("disables handoff steps already reported and leaves later ones available", () => {
    renderWithProviders(
      <EmrHandoffPanel noteText={NOTE} handoffStatus="copied_to_emr" onReportStatus={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /copied to emr/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /signed in emr/i })).toBeEnabled();
  });

  it("surfaces a rejected status report instead of silently ignoring it", () => {
    renderWithProviders(
      <EmrHandoffPanel
        noteText={NOTE}
        handoffStatus="signed_in_emr"
        onReportStatus={vi.fn()}
        statusError='Cannot move back from "Signed in EMR" to "Copied to EMR".'
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Cannot move back/);
  });

  it("presents the review acknowledgement as an AI-governance record, not a signature", async () => {
    const user = userEvent.setup();
    const onReviewAck = vi.fn();
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} onReviewAck={onReviewAck} />);

    const checkbox = screen.getByRole("checkbox", {
      name: /I reviewed this suggested documentation for accuracy/i,
    });
    expect(screen.getByText(/not a clinical signature/i)).toBeInTheDocument();

    await user.click(checkbox);
    expect(onReviewAck).toHaveBeenCalledWith(true);
  });

  it("warns when the note was edited after the review acknowledgement was made", () => {
    const ack = buildReviewAcknowledgement({ noteText: "an earlier version" });
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} reviewAck={ack} onReviewAck={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(/edited the note after reviewing/i);
    expect(
      screen.getByRole("checkbox", { name: /I reviewed this suggested documentation/i }),
    ).not.toBeChecked();
  });

  it("keeps the acknowledgement checked while the note is unchanged", () => {
    const ack = buildReviewAcknowledgement({ noteText: NOTE });
    renderWithProviders(<EmrHandoffPanel noteText={NOTE} reviewAck={ack} onReviewAck={vi.fn()} />);
    expect(
      screen.getByRole("checkbox", { name: /I reviewed this suggested documentation/i }),
    ).toBeChecked();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
