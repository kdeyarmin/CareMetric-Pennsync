import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/offlineSync", () => ({ useOfflineQueue: vi.fn() }));

import { useOfflineQueue } from "@/lib/offlineSync";
import OfflineIndicator from "./OfflineIndicator";

describe("OfflineIndicator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing while online", () => {
    useOfflineQueue.mockReturnValue({ isOnline: true });
    const { container } = render(<OfflineIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the offline banner when offline", () => {
    useOfflineQueue.mockReturnValue({ isOnline: false });
    render(<OfflineIndicator />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
    expect(screen.getByText(/sync automatically when you reconnect/i)).toBeInTheDocument();
  });
});
