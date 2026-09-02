import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";
import AcknowledgeGate, { AcknowledgeControl } from "./AcknowledgeGate";

describe("AcknowledgeGate — the shared override control", () => {
  it("renders the title and the findings passed as children", () => {
    renderWithProviders(
      <AcknowledgeGate title="Chart safety conflict" label="I reviewed this." onCheckedChange={() => {}}>
        <p>Allergy: penicillin conflicts with the documented order.</p>
      </AcknowledgeGate>,
    );
    expect(screen.getByText("Chart safety conflict")).toBeInTheDocument();
    expect(screen.getByText(/penicillin conflicts/i)).toBeInTheDocument();
  });

  it("labels the checkbox so it can be found and toggled by its text", async () => {
    const onCheckedChange = vi.fn();
    renderWithProviders(
      <AcknowledgeGate title="Denial risk" label="Save the note as documented." onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: /save the note as documented/i });
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("reveals the justification box only once the override is actually taken", async () => {
    const onJustificationChange = vi.fn();
    const { rerender } = render(
      <AcknowledgeGate
        title="Denial risk"
        label="Save as documented."
        checked={false}
        onCheckedChange={() => {}}
        onJustificationChange={onJustificationChange}
        justificationPlaceholder="Why it stands as written"
      />,
    );
    expect(screen.queryByPlaceholderText(/why it stands as written/i)).not.toBeInTheDocument();

    rerender(
      <AcknowledgeGate
        title="Denial risk"
        label="Save as documented."
        checked
        onCheckedChange={() => {}}
        onJustificationChange={onJustificationChange}
        justificationPlaceholder="Why it stands as written"
      />,
    );
    await userEvent.type(screen.getByPlaceholderText(/why it stands as written/i), "x");
    expect(onJustificationChange).toHaveBeenCalled();
  });

  it("omits the justification box entirely for gates that record no rationale", () => {
    renderWithProviders(
      <AcknowledgeGate title="These look brief" tone="amber" label="Complete as written." checked onCheckedChange={() => {}} />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders the bare control without a second card frame, for panels that own their frame", () => {
    const { container } = renderWithProviders(
      <AcknowledgeControl label="I have reviewed these denial risks." onCheckedChange={() => {}} />,
    );
    expect(screen.getByRole("checkbox", { name: /reviewed these denial risks/i })).toBeInTheDocument();
    expect(container.querySelector(".border-2")).toBeNull();
  });

  it("renders an actions slot, so the escalate button stays inside its gate", () => {
    renderWithProviders(
      <AcknowledgeGate
        title="Chart safety conflict"
        label="I reviewed this."
        onCheckedChange={() => {}}
        actions={<button type="button">Create provider follow-up task</button>}
      />,
    );
    expect(screen.getByRole("button", { name: /create provider follow-up task/i })).toBeInTheDocument();
  });
});
