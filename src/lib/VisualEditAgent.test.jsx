import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VisualEditAgent from './VisualEditAgent';

function enableVisualEditMode() {
  fireEvent(window, new MessageEvent('message', {
    data: { type: 'toggle-visual-edit-mode', data: { enabled: true } },
    source: window.parent,
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

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'element-selected', visualSelectorId: 'card-title' }),
      '*'
    );
  });
});
