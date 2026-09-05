import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import TelecomUnavailable, {
  SMS_HISTORY_UNAVAILABLE_MESSAGE,
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "./TelecomUnavailable";

describe("telecom fail-closed presentation", () => {
  it("does not present unavailable SMS history as a zero result", () => {
    renderWithProviders(
      <TelecomUnavailable
        compact
        title="Text history unavailable"
        message={SMS_HISTORY_UNAVAILABLE_MESSAGE}
      />,
    );

    expect(screen.getByText("Text history unavailable")).toBeInTheDocument();
    expect(screen.getByText(SMS_HISTORY_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /must not be interpreted as zero messages/,
    );
  });

  it("names every paused telehealth surface instead of showing empty history", () => {
    renderWithProviders(
      <TelecomUnavailable
        title="Telehealth unavailable"
        message={TELEHEALTH_UNAVAILABLE_MESSAGE}
      />,
    );

    expect(screen.getByText(TELEHEALTH_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /scheduling, session history, joining, and live vital capture/,
    );
  });
});
