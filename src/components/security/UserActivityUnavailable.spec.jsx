import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import UserActivityUnavailable, {
  USER_ACTIVITY_READ_UNAVAILABLE_MESSAGE,
} from "./UserActivityUnavailable";

describe("UserActivity fail-closed UI", () => {
  it("does not turn unavailable tenant provenance into a zero-event result", () => {
    renderWithProviders(<UserActivityUnavailable />);

    expect(screen.getByText("User activity history unavailable")).toBeInTheDocument();
    expect(screen.getByText(USER_ACTIVITY_READ_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /must not be interpreted as zero events or an all-clear result/,
    );
  });
});
