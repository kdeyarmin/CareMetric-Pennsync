import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import PresenterPicker from "./PresenterPicker";
import { manageTrainingVideos } from "@/functions/manageTrainingVideos";

vi.mock("@/functions/manageTrainingVideos", () => ({ manageTrainingVideos: vi.fn() }));

const CATALOG = {
  heygen_configured: true,
  default_avatar_id: "Daisy-inskirt-20220818",
  default_voice_id: "voice-default",
  avatars: [
    { avatar_id: "av1", name: "Alex", gender: "male", preview_image_url: "https://x/alex.png" },
    { avatar_id: "av2", name: "Bea", gender: "female", preview_image_url: "" },
  ],
  voices: [
    { voice_id: "voice-default", name: "Elizabeth", language: "English (US)", gender: "female", preview_audio_url: "https://x/liz.mp3" },
    { voice_id: "v2", name: "Marco", language: "Italian", gender: "male", preview_audio_url: "" },
  ],
};

const renderPicker = (props = {}) =>
  renderWithProviders(
    <PresenterPicker
      avatarId=""
      voiceId=""
      onAvatarChange={vi.fn()}
      onVoiceChange={vi.fn()}
      {...props}
    />
  );

describe("PresenterPicker", () => {
  beforeEach(() => {
    manageTrainingVideos.mockReset();
  });

  it("shows the not-configured notice (with the caller's hint) instead of pickers", async () => {
    manageTrainingVideos.mockResolvedValue({ data: { heygen_configured: false, avatars: [], voices: [] } });
    renderPicker({ notConfiguredHint: "Videos will be skipped." });

    expect(await screen.findByText(/HeyGen isn’t connected yet/)).toBeInTheDocument();
    expect(screen.getByText(/Videos will be skipped\./)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(manageTrainingVideos).toHaveBeenCalledWith({ action: "options" });
  });

  it("renders presenter and voice dropdowns from the catalog with a sample button", async () => {
    manageTrainingVideos.mockResolvedValue({ data: CATALOG });
    renderPicker();

    // Defaults selected in both dropdowns.
    expect(await screen.findByText("Default presenter")).toBeInTheDocument();
    expect(screen.getByText(/Default voice \(Elizabeth — friendly\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    // Default voice has a sample, so the preview button is enabled.
    expect(screen.getByRole("button", { name: /Play voice sample/i })).toBeEnabled();
  });

  it("shows the selected avatar's thumbnail and disables the sample button for voices without one", async () => {
    manageTrainingVideos.mockResolvedValue({ data: CATALOG });
    const { container } = renderPicker({ avatarId: "av1", voiceId: "v2" });

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(container.querySelector('img[src="https://x/alex.png"]')).toBeInTheDocument();
    expect(screen.getByText(/Marco · Italian/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play voice sample/i })).toBeDisabled();
  });

  it("falls back to free-text ID inputs when the catalog comes back empty", async () => {
    manageTrainingVideos.mockResolvedValue({ data: { heygen_configured: true, avatars: [], voices: [] } });
    const onAvatarChange = vi.fn();
    const onVoiceChange = vi.fn();
    renderPicker({ onAvatarChange, onVoiceChange });

    const avatarInput = await screen.findByLabelText(/Avatar ID/i);
    fireEvent.change(avatarInput, { target: { value: "custom-avatar" } });
    expect(onAvatarChange).toHaveBeenCalledWith("custom-avatar");

    fireEvent.change(screen.getByLabelText(/Voice ID/i), { target: { value: "custom-voice" } });
    expect(onVoiceChange).toHaveBeenCalledWith("custom-voice");
    expect(screen.getByText(/Couldn’t load the full avatar & voice catalog/)).toBeInTheDocument();
  });

  it("falls back per side when only one catalog half is empty", async () => {
    manageTrainingVideos.mockResolvedValue({ data: { ...CATALOG, avatars: [] } });
    const onAvatarChange = vi.fn();
    renderPicker({ onAvatarChange });

    // Avatar half: raw-ID input; voice half: still the catalog dropdown.
    const avatarInput = await screen.findByLabelText(/Avatar ID/i);
    fireEvent.change(avatarInput, { target: { value: "pasted-avatar" } });
    expect(onAvatarChange).toHaveBeenCalledWith("pasted-avatar");
    expect(screen.getByText(/Default voice \(Elizabeth — friendly\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByText(/Couldn’t load the full avatar & voice catalog/)).toBeInTheDocument();
  });
});
