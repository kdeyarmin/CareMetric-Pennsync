import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/smartNote/compliance/smartNoteOperations", () => ({
  requestSmartNoteCoverage: vi.fn(),
}));
vi.mock("@/components/utils/security", () => ({
  secureAICall: vi.fn((call) => call()),
}));

const { requestSmartNoteCoverage } = await import("@/components/smartNote/compliance/smartNoteOperations");
const { critiqueCoverage, clearCoverageCache } = await import("./completenessCritic");

const ELEMENTS = [
  { id: "safety", label: "Safety", severity: "critical", hint: "falls" },
  { id: "pain", label: "Pain", severity: "standard" },
];
const ANSWER = { elements: [{ id: "safety", documented: false }] };
const ask = (draftText = "Patient ambulated 20 ft.", elements = ELEMENTS, userKey = "nurse@example.test") =>
  critiqueCoverage({ draftText, elements }, { userKey });

describe("critiqueCoverage", () => {
  beforeEach(() => {
    clearCoverageCache();
    requestSmartNoteCoverage.mockReset();
    requestSmartNoteCoverage.mockResolvedValue(ANSWER);
  });

  it("asks once for the same draft and elements and returns the kept answer after", async () => {
    const first = await ask();
    const second = await ask();
    expect(first).toEqual({ ok: true, elements: ANSWER.elements });
    expect(second).toEqual(first);
    expect(requestSmartNoteCoverage).toHaveBeenCalledTimes(1);
    expect(requestSmartNoteCoverage).toHaveBeenCalledWith({
      draftText: "Patient ambulated 20 ft.",
      elements: [
        { id: "safety", label: "Safety", severity: "critical", hint: "falls" },
        { id: "pain", label: "Pain", severity: "standard" },
      ],
    });
  });

  it("shares one request between identical questions asked while it is in flight", async () => {
    let answer;
    requestSmartNoteCoverage.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const first = ask();
    const second = ask();
    answer(ANSWER);
    expect(await first).toEqual(await second);
    expect(requestSmartNoteCoverage).toHaveBeenCalledTimes(1);
  });

  it("asks again when the draft, the elements or the user differ", async () => {
    await ask();
    await ask("Patient ambulated 30 ft.");
    await ask(undefined, [ELEMENTS[0]]);
    await ask(undefined, [{ ...ELEMENTS[0], hint: "stairs" }, ELEMENTS[1]]);
    await ask(undefined, undefined, "other@example.test");
    expect(requestSmartNoteCoverage).toHaveBeenCalledTimes(5);
  });

  it("keeps no failure, so the next ask retries", async () => {
    requestSmartNoteCoverage.mockRejectedValueOnce(new Error("network down"));
    expect(await ask()).toEqual({ ok: false, elements: [], error: "network down" });
    requestSmartNoteCoverage.mockResolvedValueOnce({ not: "the contract" });
    expect((await ask()).ok).toBe(false);
    expect((await ask()).ok).toBe(true);
    expect(await ask()).toEqual({ ok: true, elements: ANSWER.elements });
    expect(requestSmartNoteCoverage).toHaveBeenCalledTimes(3);
  });

  it("keeps at most twenty answers, evicting the least recently used", async () => {
    for (let i = 0; i < 20; i += 1) await ask(`draft ${i}`);
    await ask("draft 0"); // used again, so draft 1 is now the oldest
    await ask("draft 20"); // evicts draft 1
    expect(requestSmartNoteCoverage).toHaveBeenCalledTimes(21);
    await ask("draft 0");
    expect(requestSmartNoteCoverage).toHaveBeenCalledTimes(21);
    await ask("draft 1");
    expect(requestSmartNoteCoverage).toHaveBeenCalledTimes(22);
  });

  it("asks nothing for an empty draft or no elements", async () => {
    expect(await ask("   ")).toEqual({ ok: true, elements: [] });
    expect(await ask(undefined, [])).toEqual({ ok: true, elements: [] });
    expect(requestSmartNoteCoverage).not.toHaveBeenCalled();
  });
});
