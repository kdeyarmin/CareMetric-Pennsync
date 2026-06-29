import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SignaturePadCanvas from './SignaturePadCanvas';

// jsdom has no real 2D canvas; stub the methods the component touches so it can
// mount and so the typed-name path can emit a data URL.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    font: '',
  }));
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,TEST');
});

describe('SignaturePadCanvas accessibility', () => {
  it('offers a keyboard-accessible input-method toggle, defaulting to Draw', () => {
    render(<SignaturePadCanvas onSignatureCapture={() => {}} />);
    const group = screen.getByRole('group', { name: /signature input method/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draw/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /type/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes the canvas to assistive tech with a descriptive label', () => {
    render(<SignaturePadCanvas onSignatureCapture={() => {}} />);
    expect(screen.getByRole('img', { name: /signature drawing area/i })).toBeInTheDocument();
  });

  it('reveals a labeled, keyboard-typable name field in Type mode', () => {
    render(<SignaturePadCanvas onSignatureCapture={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /type/i }));
    expect(screen.getByRole('button', { name: /type/i })).toHaveAttribute('aria-pressed', 'true');
    // getByLabelText only succeeds when the input is properly associated with a label.
    const input = screen.getByLabelText(/type your full name to sign/i);
    expect(input).toBeInTheDocument();
  });

  it('emits a PNG data URL when a name is typed, and null when cleared', () => {
    const onCapture = vi.fn();
    render(<SignaturePadCanvas onSignatureCapture={onCapture} />);
    fireEvent.click(screen.getByRole('button', { name: /type/i }));
    const input = screen.getByLabelText(/type your full name to sign/i);

    fireEvent.change(input, { target: { value: 'Jane Nurse' } });
    expect(onCapture).toHaveBeenLastCalledWith('data:image/png;base64,TEST');

    fireEvent.change(input, { target: { value: '   ' } });
    expect(onCapture).toHaveBeenLastCalledWith(null);
  });
});
