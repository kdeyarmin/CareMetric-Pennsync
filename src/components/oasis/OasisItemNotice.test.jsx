import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import OasisItemNotice from "./OasisItemNotice";
import { conflictingResponseSets } from "./specs/verification.js";

describe("OasisItemNotice", () => {
  it("warns against carrying a conflicting code into the EMR", () => {
    // M1340's code set is {0,1,2} exactly as CMS has it, and its code 2 means
    // "Yes — infected" where the CMS code 2 is "known but not observable". The
    // nurse must be told at the item, not only in the page banner.
    renderWithProviders(<OasisItemNotice itemId="m1340" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/not the M1340 response set/i);
    expect(alert).toHaveTextContent(/do not carry this code into your emr/i);
  });

  it("says nothing for an item whose options reproduce the CMS response set", () => {
    // A warning on every item would train nurses to ignore all of them.
    const { container } = renderWithProviders(<OasisItemNotice itemId="m1800" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the softer note for looser wording, not the alert", () => {
    // `abbreviated` means the same codes in the same order — worth re-reading in
    // the EMR, but not a code that would be wrong there. Reserving the alert for
    // real conflicts keeps the alert meaningful.
    renderWithProviders(<OasisItemNotice itemId="m1850" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/worded more loosely/i);
  });

  it("warns on an unregistered item rather than staying silent", () => {
    renderWithProviders(<OasisItemNotice itemId="m9999" />);
    expect(screen.getByRole("note")).toHaveTextContent(/has not read this item's answer choices/i);
  });

  it("never shows a CMS item number for a question that is not that item", () => {
    // M2401 asks about medication interventions; the CMS M2401 is a grid of
    // falls / depression / pain / pressure-ulcer rows. Printing "M2401" beside
    // it in the warning would reinforce the very association being warned about.
    renderWithProviders(<OasisItemNotice itemId="m2102" />);
    expect(screen.queryByText(/M2102/)).toBeNull();
  });

  it("renders a caveat for every item the read found conflicting", () => {
    for (const item of conflictingResponseSets()) {
      const { unmount } = renderWithProviders(<OasisItemNotice itemId={item.id} />);
      expect(screen.getByRole("alert")).toHaveTextContent(/do not carry this code/i);
      unmount();
    }
  });
});
