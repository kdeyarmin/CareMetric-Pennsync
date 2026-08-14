import { useEffect, useRef, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Pen, Type, Calendar, Eraser, Undo2, Trash2, CheckCircle,
  ChevronLeft, ChevronRight, Loader2, X, ZoomIn, ZoomOut
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import { isSafeExternalUrl } from "@/components/utils/security";

// Use unpkg CDN to reliably load the worker without Vite import issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const isSafePdfUrl = (url) =>
  typeof url === "string" && (url.startsWith("blob:") || isSafeExternalUrl(url));

const TOOLS = {
  PEN: "pen",
  TEXT: "text",
  DATE: "date",
  ERASER: "eraser",
};

const COLORS = ["#1e3a8a", "#dc2626", "#16a34a", "#000000", "#7c3aed"];

export default function PDFAnnotator({ pdfUrl, onAnnotatedReady, onClose }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null); // drawing overlay canvas
  const containerRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.3);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [tool, setTool] = useState(TOOLS.PEN);
  const [color, setColor] = useState("#1e3a8a");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [isDrawing, setIsDrawing] = useState(false);

  // Per-page annotation strokes stored as arrays of path objects
  const annotationsRef = useRef({}); // { [page]: [{type, data}] }
  const renderTaskRef = useRef(null); // in-flight pdf.js RenderTask (for cancellation)
  const currentStrokeRef = useRef([]);
  const lastPosRef = useRef(null);
  const textInputRef = useRef(null);
  const [textInput, setTextInput] = useState({ visible: false, x: 0, y: 0, value: "" });

  // Load PDF.
  //
  // The annotator renders inline while the document picker above it stays
  // interactive, so `pdfUrl` can change mid-load. Without the stale guard a
  // slower earlier fetch could resolve last and install the PREVIOUS document —
  // the nurse would then annotate one file while the sender faxed another.
  // Cancel the superseded load and drop its result.
  useEffect(() => {
    if (!pdfUrl) return;
    if (!isSafePdfUrl(pdfUrl)) {
      toast.error("Blocked unsafe PDF URL");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let stale = false;
    const task = pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false });
    task.promise
      .then((doc) => {
        if (stale) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
      })
      .catch((err) => {
        if (stale) return;
        console.error("PDF load error:", err);
        toast.error("Failed to load PDF for annotation");
        setIsLoading(false);
      });
    return () => {
      stale = true;
      try { task.destroy(); } catch { /* already settled/destroyed */ }
    };
  }, [pdfUrl]);

  const getAnnotations = useCallback((page) => annotationsRef.current[page] || [], []);

  // Annotations are stored in the overlay-pixel space of the scale they were
  // captured at (ann.scaleAtCapture). Replay them scaled by renderScale /
  // scaleAtCapture so they land in the same place on the page at any zoom.
  const drawAnnotation = useCallback((ctx, ann, renderScale) => {
    const factor = renderScale / (ann.scaleAtCapture || renderScale);
    if (ann.type === "stroke") {
      const { points, color, width } = ann.data;
      if (!points || points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width * factor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(points[0].x * factor, points[0].y * factor);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * factor, points[i].y * factor);
      }
      ctx.stroke();
    } else if (ann.type === "text") {
      const { x, y, text, color, size } = ann.data;
      ctx.font = `${size * factor}px Arial`;
      ctx.fillStyle = color;
      ctx.fillText(text, x * factor, y * factor);
    } else if (ann.type === "erase") {
      const { points, width } = ann.data;
      if (!points || points.length < 2) return;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.strokeStyle = "rgba(0,0,0,1)";
      // Live erasing paints circles of radius width*4 (diameter width*8); match
      // that band with the replayed stroke width so redrawn erasures aren't half-size.
      ctx.lineWidth = width * 8 * factor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(points[0].x * factor, points[0].y * factor);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * factor, points[i].y * factor);
      ctx.stroke();
      ctx.restore();
    }
  }, []);

  const redrawAnnotations = useCallback((page) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const anns = getAnnotations(page);
    anns.forEach((ann) => drawAnnotation(ctx, ann, scale));
  }, [getAnnotations, drawAnnotation, scale]);

  // Render current page to base canvas
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    // Cancel any in-flight render first so a slower earlier page/zoom can't
    // finish after — and paint over — a newer one (pdf.js doesn't auto-cancel).
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
      renderTaskRef.current = null;
    }
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (err) {
      // RenderingCancelledException is expected when a newer render supersedes.
      if (err?.name !== "RenderingCancelledException") console.error("PDF render error:", err);
      return;
    }
    if (renderTaskRef.current !== task) return; // superseded by a newer render
    renderTaskRef.current = null;

    // Size the overlay to match
    const overlay = overlayRef.current;
    overlay.width = viewport.width;
    overlay.height = viewport.height;

    // Redraw saved annotations for this page
    redrawAnnotations(pageNum);
    setIsLoading(false);
  }, [pdfDoc, pageNum, scale, redrawAnnotations]);

  useEffect(() => {
    renderPage();
    return () => {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
        renderTaskRef.current = null;
      }
    };
  }, [renderPage]);

  const saveAnnotation = (page, annotation) => {
    if (!annotationsRef.current[page]) annotationsRef.current[page] = [];
    annotationsRef.current[page].push(annotation);
  };

  const getPos = (e) => {
    const overlay = overlayRef.current;
    const rect = overlay.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (overlay.width / rect.width),
      y: (clientY - rect.top) * (overlay.height / rect.height),
    };
  };

  const handlePointerDown = (e) => {
    if (tool === TOOLS.TEXT || tool === TOOLS.DATE) {
      const pos = getPos(e);
      const value = tool === TOOLS.DATE
        ? new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
        : "";
      setTextInput({ visible: true, x: pos.x, y: pos.y, value });
      return;
    }
    e.preventDefault();
    setIsDrawing(true);
    const pos = getPos(e);
    currentStrokeRef.current = [pos];
    lastPosRef.current = pos;
  };

  const handlePointerMove = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    currentStrokeRef.current.push(pos);

    const overlay = overlayRef.current;
    const ctx = overlay.getContext("2d");

    if (tool === TOOLS.ERASER) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, strokeWidth * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    lastPosRef.current = pos;
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const points = currentStrokeRef.current;
    if (points.length < 2) return;
    const type = tool === TOOLS.ERASER ? "erase" : "stroke";
    saveAnnotation(pageNum, {
      type,
      scaleAtCapture: scale,
      data: { points: [...points], color, width: strokeWidth },
    });
    currentStrokeRef.current = [];
  };

  const handleTextCommit = () => {
    if (!textInput.value.trim()) {
      setTextInput({ ...textInput, visible: false });
      return;
    }
    const overlay = overlayRef.current;
    const ctx = overlay.getContext("2d");
    const fontSize = 16;
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = color;
    ctx.fillText(textInput.value, textInput.x, textInput.y);
    saveAnnotation(pageNum, {
      type: "text",
      scaleAtCapture: scale,
      data: { x: textInput.x, y: textInput.y, text: textInput.value, color, size: fontSize },
    });
    setTextInput({ ...textInput, visible: false, value: "" });
  };

  const handleUndo = () => {
    if (!annotationsRef.current[pageNum]?.length) return;
    annotationsRef.current[pageNum].pop();
    redrawAnnotations(pageNum);
  };

  const handleClearPage = () => {
    annotationsRef.current[pageNum] = [];
    redrawAnnotations(pageNum);
  };

  // Flatten annotations onto PDF pages and export
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "px" });
      let firstPage = true;

      for (let p = 1; p <= numPages; p++) {
        const page = await pdfDoc.getPage(p);
        const viewport = page.getViewport({ scale });

        // Render PDF page to temp canvas (base layer)
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        const tempCtx = tempCanvas.getContext("2d");
        await page.render({ canvasContext: tempCtx, viewport }).promise;

        // Draw annotations onto a SEPARATE transparent overlay first, then
        // composite it over the page — mirroring the live two-canvas model. This
        // keeps eraser strokes (destination-out) from punching alpha holes through
        // the PDF content (which JPEG would then flatten to black smears).
        const anns = getAnnotations(p);
        if (anns.length > 0) {
          const annCanvas = document.createElement("canvas");
          annCanvas.width = viewport.width;
          annCanvas.height = viewport.height;
          const annCtx = annCanvas.getContext("2d");
          anns.forEach((ann) => drawAnnotation(annCtx, ann, scale));
          tempCtx.drawImage(annCanvas, 0, 0);
        }

        const imgData = tempCanvas.toDataURL("image/jpeg", 0.92);
        const w = viewport.width;
        const h = viewport.height;

        if (!firstPage) pdf.addPage([w, h]);
        else pdf.internal.pageSize.width = w, pdf.internal.pageSize.height = h;

        pdf.addImage(imgData, "JPEG", 0, 0, w, h);
        firstPage = false;
      }

      const pdfBlob = pdf.output("blob");
      const file = new File([pdfBlob], "annotated-fax.pdf", { type: "application/pdf" });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      toast.success("Annotations applied — ready to fax!");
      onAnnotatedReady(file_url);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save annotations: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const toolButtons = [
    { id: TOOLS.PEN, icon: Pen, label: "Draw" },
    { id: TOOLS.TEXT, icon: Type, label: "Text" },
    { id: TOOLS.DATE, icon: Calendar, label: "Date" },
    { id: TOOLS.ERASER, icon: Eraser, label: "Erase" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col">
      {/* Top Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3 flex-wrap shadow-md">
        <div className="flex items-center gap-1 font-semibold text-slate-800 mr-2">
          <Pen className="w-4 h-4 text-indigo-600" />
          Annotate PDF
        </div>

        {/* Tool selector */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {toolButtons.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              title={label}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                tool === id
                  ? "bg-white shadow text-indigo-700 ring-1 ring-indigo-300"
                  : "text-slate-600 hover:bg-white/60"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Colors */}
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                color === c ? "scale-125 border-slate-700" : "border-transparent hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Stroke width */}
        {tool !== TOOLS.TEXT && tool !== TOOLS.DATE && (
          <div className="flex items-center gap-2 min-w-[100px]">
            <span className="text-xs text-slate-500">Size</span>
            <Slider
              min={1} max={10} step={1}
              value={[strokeWidth]}
              onValueChange={([v]) => setStrokeWidth(v)}
              className="w-20"
            />
            <span className="text-xs text-slate-500 w-4">{strokeWidth}</span>
          </div>
        )}

        {/* Undo / Clear */}
        <div className="flex gap-1 ml-auto">
          <Button variant="outline" size="sm" onClick={handleUndo} className="h-8 gap-1 text-xs">
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearPage} className="h-8 gap-1 text-xs text-red-600 border-red-200 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </Button>
        </div>

        {/* Save / Close */}
        <Button onClick={handleSave} disabled={isSaving} size="sm" className="h-8 gap-1.5 text-xs">
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
          {isSaving ? "Saving..." : "Apply & Use"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 text-slate-500">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 overflow-auto bg-slate-700 flex items-start justify-center p-6" ref={containerRef}>
        {isLoading && (
          <div className="flex items-center gap-2 text-white mt-20">
            <Loader2 className="w-6 h-6 animate-spin" />
            Loading PDF…
          </div>
        )}
        <div className="relative shadow-2xl" style={{ display: isLoading ? "none" : "block" }}>
          {/* Base PDF render */}
          <canvas ref={canvasRef} className="block" />
          {/* Drawing overlay */}
          <canvas
            ref={overlayRef}
            className="absolute inset-0"
            style={{ cursor: tool === TOOLS.ERASER ? "cell" : tool === TOOLS.TEXT || tool === TOOLS.DATE ? "text" : "crosshair", touchAction: "none" }}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
          {/* Floating text input */}
          {textInput.visible && (
            <div
              className="absolute z-10"
              style={{
                left: textInput.x * (overlayRef.current?.getBoundingClientRect().width / overlayRef.current?.width || 1),
                top: textInput.y * (overlayRef.current?.getBoundingClientRect().height / overlayRef.current?.height || 1) - 10,
              }}
            >
              <input
                ref={textInputRef}
                autoFocus
                value={textInput.value}
                onChange={(e) => setTextInput(t => ({ ...t, value: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") handleTextCommit(); if (e.key === "Escape") setTextInput(t => ({ ...t, visible: false })); }}
                onBlur={handleTextCommit}
                className="border border-indigo-400 rounded px-1 py-0.5 text-sm shadow bg-white/90 min-w-[120px] outline-none ring-2 ring-indigo-300"
                style={{ color }}
                placeholder={tool === TOOLS.DATE ? "Date" : "Type text…"}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Page Navigation */}
      <div className="bg-white border-t border-slate-200 px-4 py-2 flex items-center justify-center gap-4 shadow-md">
        <Button variant="outline" size="sm" disabled={pageNum <= 1} onClick={() => setPageNum(p => p - 1)} className="h-8 w-8 p-0">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Page {pageNum} of {numPages}
          </Badge>
          {Object.keys(annotationsRef.current).filter(p => annotationsRef.current[p]?.length > 0).length > 0 && (
            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-xs">
              {Object.values(annotationsRef.current).reduce((s, a) => s + (a?.length || 0), 0)} annotations
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" disabled={pageNum >= numPages} onClick={() => setPageNum(p => p + 1)} className="h-8 w-8 p-0">
          <ChevronRight className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-1 ml-4">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setScale(s => Math.max(0.6, s - 0.2))}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-slate-500 w-10 text-center">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setScale(s => Math.min(2.5, s + 0.2))}>
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}