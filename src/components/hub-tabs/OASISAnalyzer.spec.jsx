import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";

const { authMe, functionInvoke, entityRead } = vi.hoisted(() => ({
  authMe: vi.fn(),
  functionInvoke: vi.fn(),
  entityRead: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: authMe },
    functions: { invoke: functionInvoke },
    entities: new Proxy({}, {
      get: () => ({ list: entityRead, filter: entityRead, get: entityRead }),
    }),
  },
}));

vi.mock("@/lib/invokeLLM", () => ({
  invokeLLM: functionInvoke,
  invokeLLMWithFile: functionInvoke,
}));

describe("OASISAnalyzer containment gate", () => {
  it("renders a static paused notice before hooks, reads, AI, or child mounts", async () => {
    const { default: OASISAnalyzer } = await import("@/components/hub-tabs/OASISAnalyzer");
    renderWithProviders(<OASISAnalyzer />);

    expect(screen.getByText("OASIS AI Analyzer Paused")).toBeInTheDocument();
    expect(screen.getByText(/No analysis, background query, AI request/i)).toBeInTheDocument();
    expect(authMe).not.toHaveBeenCalled();
    expect(functionInvoke).not.toHaveBeenCalled();
    expect(entityRead).not.toHaveBeenCalled();
  });
});
