import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CLINICAL_GROUPS } from "./pdgmGrouper.js";
import { EXPECTED_GROUP_COUNT } from "./caseMixWeightsLoader.js";
import CaseMixWeightsUpload from "./CaseMixWeightsUpload.jsx";

const HEADER = "Clinical Group,Admission Source,Timing,Functional Level,Comorbidity Adjustment,Case-Mix Weight,HIPPS,LUPA Threshold";
const csvField = (s) => (s.includes(",") ? `"${s}"` : s);

// A complete official-shaped table: 2 timing × 2 source × 12 groups × 3
// functional × 3 comorbidity = 432 rows, all weights in the plausible range.
function fullCsv() {
  const lines = [HEADER];
  for (const timing of ["Early", "Late"]) {
    for (const source of ["Community", "Institutional"]) {
      for (const group of CLINICAL_GROUPS) {
        for (const fn of ["Low", "Medium", "High"]) {
          for (const co of ["None", "Low", "High"]) {
            lines.push([csvField(group), source, timing, fn, co, "1.0000", "1AA11", "4"].join(","));
          }
        }
      }
    }
  }
  return lines.join("\n");
}

const csvFile = (content, name = "cy2026-weights.csv") =>
  new File([content], name, { type: "text/csv" });

const uploadInput = (container) => container.querySelector('input[type="file"]');

describe("CaseMixWeightsUpload", () => {
  it("parses a complete CMS CSV and persists the reference table with metadata", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn().mockResolvedValue();
    const { container } = render(
      <CaseMixWeightsUpload storedTable={null} onPersist={onPersist} uploadedBy="admin@agency.test" defaultYear="2026" />,
    );

    // Reference-only labeling is present up front.
    expect(screen.getByText(/payment estimates remain from the PDGM engine/i)).toBeInTheDocument();

    await user.upload(uploadInput(container), csvFile(fullCsv()));
    expect(await screen.findByText(new RegExp(`${EXPECTED_GROUP_COUNT} of ${EXPECTED_GROUP_COUNT} payment groups`))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /store reference table/i }));

    expect(onPersist).toHaveBeenCalledTimes(1);
    const stored = onPersist.mock.calls[0][0];
    expect(stored.payment_year).toBe("2026");
    expect(stored.source).toBe("cy2026-weights.csv");
    expect(stored.uploaded_by_email).toBe("admin@agency.test");
    expect(stored.groups).toBe(EXPECTED_GROUP_COUNT);
    expect(Object.keys(stored.rows)).toHaveLength(EXPECTED_GROUP_COUNT);
  });

  it("shows the loader's unmappable-row report and never persists a partial table", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn();
    const { container } = render(<CaseMixWeightsUpload storedTable={null} onPersist={onPersist} />);

    const csv = `${HEADER}\nNot A Group,Community,Early,Low,None,1.1,x,\nWound,Community,Early,Low,None,99,x,`;
    await user.upload(uploadInput(container), csvFile(csv, "broken.csv"));

    expect(await screen.findByText(/not stored/i)).toBeInTheDocument();
    // The loader's row-level report is surfaced verbatim.
    expect(screen.getByText(/unmappable clinical group "Not A Group"/i)).toBeInTheDocument();
    expect(screen.getByText(/weight 99 outside plausible range/i)).toBeInTheDocument();
    // Strict completeness errors are part of the report too.
    expect(screen.getByText(/Incomplete table/i)).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /store reference table/i })).not.toBeInTheDocument();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("shows the stored table's provenance and can remove it", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn().mockResolvedValue();
    render(
      <CaseMixWeightsUpload
        storedTable={{
          payment_year: "2026",
          source: "weights.csv",
          uploaded_at: "2026-07-01T12:00:00.000Z",
          uploaded_by_email: "admin@agency.test",
          groups: 432,
          rows: { "early|community|Wound|low|none": { weight: 1.2 } },
        }}
        onPersist={onPersist}
      />,
    );

    expect(screen.getByText(/CY2026/)).toBeInTheDocument();
    expect(screen.getByText(/432 payment groups/)).toBeInTheDocument();
    expect(screen.getByText(/admin@agency\.test/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onPersist).toHaveBeenCalledWith(null);
  });

  it("blocks storing while disabled (e.g. unsaved rate edits) and explains why", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn();
    const { container } = render(
      <CaseMixWeightsUpload
        storedTable={null}
        onPersist={onPersist}
        disabled
        disabledReason="You have unsaved rate edits — save or reset them first."
      />,
    );

    await user.upload(uploadInput(container), csvFile(fullCsv()));
    const storeBtn = await screen.findByRole("button", { name: /store reference table/i });
    expect(storeBtn).toBeDisabled();
    expect(screen.getByText(/unsaved rate edits/i)).toBeInTheDocument();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("loads the bundled CMS CY 2026 table through the same strict preview flow and stores it", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn().mockResolvedValue();
    render(<CaseMixWeightsUpload storedTable={null} onPersist={onPersist} uploadedBy="admin@agency.test" />);

    await user.click(screen.getByRole("button", { name: /load cms cy 2026 table \(bundled\)/i }));
    // Full official table previews clean: all 432 payment groups mapped.
    expect(await screen.findByText(new RegExp(`${EXPECTED_GROUP_COUNT} of ${EXPECTED_GROUP_COUNT} payment groups`))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /store reference table \(CY2026\)/i }));
    expect(onPersist).toHaveBeenCalledTimes(1);
    const stored = onPersist.mock.calls[0][0];
    expect(stored.payment_year).toBe("2026");
    expect(stored.groups).toBe(EXPECTED_GROUP_COUNT);
    expect(stored.source).toMatch(/CY 2026 Final HH PDGM Case Mix Weights/);
    // Spot value verbatim from the CMS file.
    const bh = Object.entries(stored.rows).find(([, v]) => v.hipps === "1FC11");
    expect(bh[1]).toMatchObject({ weight: 1.0804, lupaThreshold: 4 });
  });
});
