import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/testUtils";
import SmartNoteNav from "./SmartNoteNav";

const noop = () => {};

describe("SmartNoteNav — one bar for the flow and its tools", () => {
  it("marks the current step while writing", () => {
    renderWithProviders(<SmartNoteNav step={1} activeTab="builder" setActiveTab={noop} />);
    const current = screen.getByText("Write").closest("[aria-current='step']");
    expect(current).toBeInTheDocument();
    expect(screen.getByText("Review & Generate").closest("[aria-current='step']")).toBeNull();
  });

  it("moves the current-step marker on to review", () => {
    renderWithProviders(<SmartNoteNav step={2} activeTab="builder" setActiveTab={noop} />);
    expect(screen.getByText("Review & Generate").closest("[aria-current='step']")).toBeInTheDocument();
    expect(screen.getByText("Write").closest("[aria-current='step']")).toBeNull();
  });

  it("keeps the tools subordinate to the note flow, not peers of it", () => {
    renderWithProviders(<SmartNoteNav step={1} activeTab="builder" setActiveTab={noop} />);
    for (const label of ["Structured draft", "Visit summary", "Vital trends"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("opens a tool when its button is pressed", async () => {
    const setActiveTab = vi.fn();
    renderWithProviders(<SmartNoteNav step={1} activeTab="builder" setActiveTab={setActiveTab} />);
    await userEvent.click(screen.getByRole("button", { name: "Vital trends" }));
    expect(setActiveTab).toHaveBeenCalledWith("trends");
  });

  it("shows the open tool and always offers a way back to the note", async () => {
    const setActiveTab = vi.fn();
    renderWithProviders(<SmartNoteNav step={1} activeTab="summary" setActiveTab={setActiveTab} />);
    expect(screen.getByRole("button", { name: "Visit summary" })).toHaveAttribute("aria-pressed", "true");
    // The step pills give way to the tool's own context while it is open.
    expect(screen.queryByText("Review & Generate")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back to note/i }));
    expect(setActiveTab).toHaveBeenCalledWith("builder");
  });

  it("closes an open tool by pressing it again, rather than stranding the nurse", async () => {
    const setActiveTab = vi.fn();
    renderWithProviders(<SmartNoteNav step={1} activeTab="drafter" setActiveTab={setActiveTab} />);
    await userEvent.click(screen.getByRole("button", { name: "Structured draft" }));
    expect(setActiveTab).toHaveBeenCalledWith("builder");
  });
});
