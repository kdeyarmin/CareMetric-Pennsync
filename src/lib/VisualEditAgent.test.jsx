import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VisualEditAgent from './VisualEditAgent';

// A real browser always stamps event.origin with the sender's origin; only a
// synthetic MessageEvent leaves it ''. Send from our own origin, which the
// agent's editor allowlist accepts.
function enableVisualEditMode(origin = window.location.origin) {
  fireEvent(window, new MessageEvent('message', {
    data: { type: 'toggle-visual-edit-mode', data: { enabled: true } },
    source: window.parent,
    origin,
  }));
}

describe('VisualEditAgent preview click handling', () => {
  afterEach(() => {
    cleanup();
    document.body.style.cursor = '';
    vi.restoreAllMocks();
  });

  it('does not swallow annotated navigation links while visual edit mode is enabled', () => {
    const onClick = vi.fn((event) => event.preventDefault());
    render(
      <>
        <VisualEditAgent />
        <a href="/Dashboard" data-source-location="nav-link" onClick={onClick}>Dashboard</a>
      </>
    );

    enableVisualEditMode();
    fireEvent.click(screen.getByText('Dashboard'));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('still selects non-interactive annotated elements for visual editing', () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    render(
      <>
        <VisualEditAgent />
        <div data-source-location="card-title">Care plan summary</div>
      </>
    );

    enableVisualEditMode();
    fireEvent.click(screen.getByText('Care plan summary'));

    // Target origin may be '*' (no configured editor) or an allowlisted
    // backend/editor origin from appParams — assert payload, not the origin.
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'element-selected', visualSelectorId: 'card-title' }),
      expect.any(String),
    );
  });

  it('redacts dynamic chart content from element-selected payloads', () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    render(
      <>
        <VisualEditAgent />
        <div data-source-location="patient-name" data-dynamic-content="true">Jane Doe PHI</div>
      </>
    );

    enableVisualEditMode();
    fireEvent.click(screen.getByText('Jane Doe PHI'));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'element-selected',
        visualSelectorId: 'patient-name',
        isDynamicContent: true,
        content: '',
      }),
      expect.any(String),
    );
  });

  it('ignores a toggle from an origin outside the editor allowlist', () => {
    // The origin check was commented out while this component mounts in
    // production, so any page framing the app could enable edit mode and then
    // receive the selected element — including element.innerText, which on a
    // patient chart is PHI.
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    render(
      <>
        <VisualEditAgent />
        <div data-source-location="card-title">Care plan summary</div>
      </>
    );

    enableVisualEditMode('https://evil.example.com');
    fireEvent.click(screen.getByText('Care plan summary'));

    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'element-selected' }),
      expect.anything()
    );
  });
});
