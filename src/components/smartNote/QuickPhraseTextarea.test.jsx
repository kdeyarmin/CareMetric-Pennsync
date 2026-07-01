import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuickPhraseTextarea from "./QuickPhraseTextarea";

// Controlled harness (the component is controlled, like its use in the drafter).
function Harness(props) {
  const [value, setValue] = useState(props.initial ?? "");
  return <QuickPhraseTextarea value={value} onChange={setValue} {...props} />;
}

describe("QuickPhraseTextarea", () => {
  it("opens the quick-phrase menu when a .dot-token is typed", async () => {
    render(<Harness />);
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: ".diab", selectionStart: 5 } });
    expect(await screen.findByText(".diabeticedu")).toBeInTheDocument();
  });

  it("inserts the expanded phrase at the caret on selection", async () => {
    render(<Harness />);
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: ".diab", selectionStart: 5 } });
    const option = await screen.findByText(".diabeticedu");
    fireEvent.mouseDown(option);
    await waitFor(() =>
      expect(screen.getByRole("textbox").value).toMatch(/diabetic self-management education/i),
    );
    // the trigger token is gone, replaced by the expansion
    expect(screen.getByRole("textbox").value).not.toMatch(/\.diab\b/);
  });

  it("does not open the menu for an ordinary sentence period", () => {
    render(<Harness />);
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "Patient tolerated care.", selectionStart: 23 } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports a leading / slash menu", async () => {
    render(<Harness />);
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "/wound", selectionStart: 6 } });
    expect(await screen.findByText(".woundcare")).toBeInTheDocument();
  });
});
