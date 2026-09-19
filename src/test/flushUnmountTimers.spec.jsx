import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { flushUnmountTimers } from "./flushUnmountTimers.js";

// Guards the shared afterEach in ./setup.js. Unmounting a Radix focus scope
// does not restore focus inline — it queues a macrotask that dispatches a DOM
// event on the scope container. A pending one at end-of-file fires after Vitest
// has torn the jsdom window down and crashes the run with an unhandled
// "parameter 1 is not of type 'Event'". These tests prove the deferral is real
// and that flushUnmountTimers() settles it inside the window.
describe("flushUnmountTimers", () => {
  it("runs the focus restore a dialog unmount defers to a macrotask", async () => {
    const { unmount } = render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>Deferred focus restore</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    const container = await screen.findByRole("dialog");
    let restores = 0;
    container.addEventListener("focusScope.autoFocusOnUnmount", () => {
      restores += 1;
    });

    unmount();
    // If this ever becomes 1, Radix stopped deferring and the drain is dead weight.
    expect(restores).toBe(0);

    await flushUnmountTimers();
    expect(restores).toBe(1);
  });

  it("drains timers queued before it, in order", async () => {
    const order = [];
    setTimeout(() => order.push("queued-first"), 0);
    await flushUnmountTimers();
    order.push("after-flush");
    expect(order).toEqual(["queued-first", "after-flush"]);
  });

  it("still resolves when a spec leaves fake timers installed", async () => {
    vi.useFakeTimers();
    try {
      // A drain bound to the mocked clock would never resolve, and this test
      // would hang to its timeout rather than fail fast.
      await expect(flushUnmountTimers()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
