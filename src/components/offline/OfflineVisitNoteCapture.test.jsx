import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OfflineVisitNoteCapture from "./OfflineVisitNoteCapture";
import { addToSyncQueue } from "@/lib/indexedDB";

vi.mock("@/lib/indexedDB", () => ({ addToSyncQueue: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/offlineSync", () => ({ drainSyncQueue: vi.fn() }));

const patient = { id: "p1", first_name: "Jane", last_name: "Doe" };

describe("OfflineVisitNoteCapture compliance gate", () => {
  beforeEach(() => addToSyncQueue.mockClear());

  it("runs the compliance scan before queuing and holds a gappy note for review", async () => {
    render(<OfflineVisitNoteCapture patient={patient} />);
    // Minimal required fields, but a sparse narrative (no homebound / skilled need).
    fireEvent.change(screen.getByPlaceholderText(/Clinical assessment/i), { target: { value: "Patient seen." } });
    fireEvent.change(screen.getByPlaceholderText(/Ongoing plan/i), { target: { value: "Follow up next visit." } });
    fireEvent.click(screen.getByRole("button", { name: /Save Visit Note/i }));

    // The compliance panel appears and the note is NOT queued on this first click.
    expect(await screen.findByText(/Compliance scan/i)).toBeInTheDocument();
    expect(screen.getByText(/Homebound status \(required\)/i)).toBeInTheDocument();
    expect(addToSyncQueue).not.toHaveBeenCalled();
  });

  it("queues as pending_review with grounding deferred after acknowledgement", async () => {
    render(<OfflineVisitNoteCapture patient={patient} />);
    fireEvent.change(screen.getByPlaceholderText(/Clinical assessment/i), { target: { value: "Patient seen." } });
    fireEvent.change(screen.getByPlaceholderText(/Ongoing plan/i), { target: { value: "Follow up." } });

    fireEvent.click(screen.getByRole("button", { name: /Save Visit Note/i })); // first: scan + hold
    await screen.findByText(/Compliance scan/i);
    fireEvent.click(screen.getByRole("button", { name: /Queue for review anyway/i })); // second: queue

    await waitFor(() => expect(addToSyncQueue).toHaveBeenCalledTimes(1));
    const [, payload] = addToSyncQueue.mock.calls[0];
    expect(payload.status).toBe("pending_review");
    expect(payload.grounding_pending).toBe(true);
    expect(payload.documentation_source).toBe("manual");
  });
});
