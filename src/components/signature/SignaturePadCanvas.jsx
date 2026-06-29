import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RotateCcw, Pen, Keyboard } from 'lucide-react';

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 150;

/**
 * Signature capture with two accessible input paths so signing never requires a
 * mouse/touchpad: freehand drawing (mouse + touch) and a keyboard-friendly
 * "Type" mode that renders the typed name to the same PNG data URL. Both modes
 * emit through the single `onSignatureCapture(pngDataUrl | null)` contract, so
 * consumers are unaffected by which path the signer used.
 */
export default function SignaturePadCanvas({ onSignatureCapture, disabled = false }) {
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('draw'); // 'draw' | 'type'
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [typedName, setTypedName] = useState('');
  // Tracks whether a stroke was actually drawn this gesture. Read in mouseUp
  // instead of the `isEmpty` state, which may not have re-rendered yet after the
  // first stroke's setIsEmpty(false) (stale-closure → dropped first signature).
  const hasDrawnRef = useRef(false);

  const getCtx = () => canvasRef.current?.getContext('2d');

  // The canvas intrinsic resolution (500x150) differs from its CSS display size
  // (w-full h-40), so raw client coordinates must be scaled to canvas space or
  // every stroke lands in the wrong place / wrong scale.
  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  useEffect(() => {
    const ctx = getCtx();
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000';
    }
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  // --- Freehand drawing (mouse) ---
  const handleMouseDown = (e) => {
    if (disabled) return;
    setIsDrawing(true);
    // Reset per gesture: a click/tap with no movement should not re-emit the
    // canvas on mouseup just because an earlier gesture drew something.
    hasDrawnRef.current = false;
    const ctx = getCtx();
    const { x, y } = getCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || disabled) return;
    const ctx = getCtx();
    const { x, y } = getCanvasCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasDrawnRef.current = true;
    setIsEmpty(false);
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const ctx = getCtx();
    ctx?.closePath();
    if (hasDrawnRef.current) {
      onSignatureCapture?.(canvasRef.current.toDataURL('image/png'));
    }
  };

  // --- Touch (proxied to the mouse handlers) ---
  const handleTouchStart = (e) => {
    if (disabled) return;
    const touch = e.touches[0];
    canvasRef.current?.dispatchEvent(
      new MouseEvent('mousedown', { clientX: touch.clientX, clientY: touch.clientY })
    );
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    if (disabled) return;
    const touch = e.touches[0];
    canvasRef.current?.dispatchEvent(
      new MouseEvent('mousemove', { clientX: touch.clientX, clientY: touch.clientY })
    );
  };

  const handleTouchEnd = () => {
    canvasRef.current?.dispatchEvent(new MouseEvent('mouseup', {}));
  };

  // --- Typed signature (keyboard-accessible) ---
  const renderTypedSignature = useCallback((name) => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const trimmed = name.trim();
    if (!trimmed) {
      setIsEmpty(true);
      onSignatureCapture?.(null);
      return;
    }
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 48px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';
    ctx.fillText(trimmed, canvas.width / 2, canvas.height / 2, canvas.width - 24);
    setIsEmpty(false);
    onSignatureCapture?.(canvas.toDataURL('image/png'));
  }, [onSignatureCapture]);

  const handleTypedNameChange = (e) => {
    const value = e.target.value;
    setTypedName(value);
    renderTypedSignature(value);
  };

  const switchMode = (next) => {
    if (disabled || next === mode) return;
    setMode(next);
    setTypedName('');
    setIsDrawing(false);
    clearCanvas();
    hasDrawnRef.current = false;
    setIsEmpty(true);
    onSignatureCapture?.(null);
  };

  const handleClear = () => {
    clearCanvas();
    setTypedName('');
    hasDrawnRef.current = false;
    setIsEmpty(true);
    onSignatureCapture?.(null);
  };

  return (
    <div className="space-y-3">
      {/* Mode toggle — keyboard accessible alternative to mouse-only drawing */}
      <div role="group" aria-label="Signature input method" className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'draw' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchMode('draw')}
          disabled={disabled}
          aria-pressed={mode === 'draw'}
          className="flex-1 gap-2"
        >
          <Pen className="w-4 h-4" aria-hidden="true" />
          Draw
        </Button>
        <Button
          type="button"
          variant={mode === 'type' ? 'default' : 'outline'}
          size="sm"
          onClick={() => switchMode('type')}
          disabled={disabled}
          aria-pressed={mode === 'type'}
          className="flex-1 gap-2"
        >
          <Keyboard className="w-4 h-4" aria-hidden="true" />
          Type
        </Button>
      </div>

      {mode === 'type' && (
        <div>
          <Label htmlFor="typed-signature-name" className="text-sm">
            Type your full name to sign
          </Label>
          <Input
            id="typed-signature-name"
            value={typedName}
            onChange={handleTypedNameChange}
            disabled={disabled}
            placeholder="Full legal name"
            autoComplete="name"
            aria-describedby="typed-signature-hint"
          />
          <p id="typed-signature-hint" className="text-xs text-slate-500 mt-1">
            Your typed name is rendered as your signature below.
          </p>
        </div>
      )}

      <div className="border-2 border-dashed border-slate-300 rounded-lg bg-slate-50 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onMouseDown={mode === 'draw' ? handleMouseDown : undefined}
          onMouseMove={mode === 'draw' ? handleMouseMove : undefined}
          onMouseUp={mode === 'draw' ? handleMouseUp : undefined}
          onMouseLeave={mode === 'draw' ? handleMouseUp : undefined}
          onTouchStart={mode === 'draw' ? handleTouchStart : undefined}
          onTouchMove={mode === 'draw' ? handleTouchMove : undefined}
          onTouchEnd={mode === 'draw' ? handleTouchEnd : undefined}
          role="img"
          aria-label={
            mode === 'draw'
              ? 'Signature drawing area. Draw with your mouse or touchpad, or switch to Type mode.'
              : 'Preview of your typed signature'
          }
          className={`w-full h-40 bg-white ${mode === 'draw' && !disabled ? 'cursor-crosshair' : ''}`}
          style={{ touchAction: 'none' }}
        />
      </div>

      {mode === 'draw' && (
        <p className="text-xs text-slate-500">
          Sign above with your mouse or touchpad — or choose “Type” to sign with your keyboard.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClear}
        disabled={isEmpty || disabled}
        className="w-full gap-2"
      >
        <RotateCcw className="w-4 h-4" aria-hidden="true" />
        Clear Signature
      </Button>
    </div>
  );
}
