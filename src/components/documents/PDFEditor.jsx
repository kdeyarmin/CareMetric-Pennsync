import { useState, useRef, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as pdfjsLib from "pdfjs-dist";
import {
  Type,
  Highlighter, 
  Pencil, 
  Save,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut,
  Undo,
  Redo
} from "lucide-react";
import { toast } from "sonner";

// Use unpkg CDN to reliably load the worker without Vite import issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function PDFEditor({ pdfUrl, onSave }) {
  const canvasRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [tool, setTool] = useState('text');
  const [color, setColor] = useState('#FF0000');
  const [annotations, setAnnotations] = useState([]);
  // Seed history with the initial empty state at index 0 so the first annotation
  // can be undone back to a blank document (handleUndo guards historyIndex > 0).
  const [history, setHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState([]);

  const loadPDF = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadingTask = pdfjsLib.getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setIsLoading(false);
    } catch (error) {
      console.error("Error loading PDF:", error);
      toast.error("Failed to load PDF");
      setIsLoading(false);
    }
  }, [pdfUrl]);

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    // Render annotations
    annotations
      .filter(ann => ann.page === currentPage)
      .forEach(ann => {
        if (ann.type === 'text') {
          context.font = `${ann.fontSize || 16}px Arial`;
          context.fillStyle = ann.color;
          context.fillText(ann.text, ann.x, ann.y);
        } else if (ann.type === 'highlight') {
          context.fillStyle = ann.color + '40';
          context.fillRect(ann.x, ann.y, ann.width, ann.height);
        } else if (ann.type === 'draw') {
          context.strokeStyle = ann.color;
          context.lineWidth = ann.lineWidth || 2;
          context.beginPath();
          ann.path.forEach((point, idx) => {
            if (idx === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
          });
          context.stroke();
        }
      });
  }, [pdfDoc, currentPage, scale, annotations]);

  useEffect(() => {
    loadPDF();
  }, [loadPDF]);

  useEffect(() => {
    if (pdfDoc) {
      renderPage();
    }
  }, [pdfDoc, renderPage]);

  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        addAnnotation({
          type: 'text',
          text,
          x,
          y,
          color,
          fontSize: 16,
          page: currentPage
        });
      }
    }
  };

  const handleMouseDown = (e) => {
    if (tool !== 'draw' && tool !== 'highlight') return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsDrawing(true);
    setCurrentPath([{ x, y }]);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setCurrentPath(prev => [...prev, { x, y }]);
    
    // Live preview
    const context = canvasRef.current.getContext('2d');
    if (tool === 'draw') {
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.lineTo(x, y);
      context.stroke();
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    
    setIsDrawing(false);
    
    if (currentPath.length > 1) {
      if (tool === 'draw') {
        addAnnotation({
          type: 'draw',
          path: currentPath,
          color,
          lineWidth: 2,
          page: currentPage
        });
      } else if (tool === 'highlight') {
        const xs = currentPath.map(p => p.x);
        const ys = currentPath.map(p => p.y);
        addAnnotation({
          type: 'highlight',
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          color,
          page: currentPage
        });
      }
    }
    
    setCurrentPath([]);
  };

  const addAnnotation = (annotation) => {
    const newAnnotations = [...annotations, annotation];
    setAnnotations(newAnnotations);
    
    // Update history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newAnnotations);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setAnnotations(history[historyIndex - 1]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setAnnotations(history[historyIndex + 1]);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await base44.functions.invoke('saveAnnotatedPDF', {
        original_pdf_url: pdfUrl,
        annotations,
        total_pages: totalPages
      });

      toast.success("PDF saved successfully!");
      if (onSave) {
        onSave(response.data.annotated_pdf_url);
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error(`Failed to save PDF: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-slate-600">Loading PDF...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>PDF Editor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 rounded-lg">
          <Button
            variant={tool === 'text' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTool('text')}
          >
            <Type className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'highlight' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTool('highlight')}
          >
            <Highlighter className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'draw' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTool('draw')}
          >
            <Pencil className="w-4 h-4" />
          </Button>
          
          <div className="h-6 w-px bg-slate-300 mx-1" />
          
          <Input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-12 h-9 p-1"
          />
          
          <div className="h-6 w-px bg-slate-300 mx-1" />
          
          <Button variant="outline" size="sm" onClick={handleUndo} disabled={historyIndex <= 0}>
            <Undo className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleRedo} disabled={historyIndex >= history.length - 1}>
            <Redo className="w-4 h-4" />
          </Button>
          
          <div className="h-6 w-px bg-slate-300 mx-1" />
          
          <Button variant="outline" size="sm" onClick={() => setScale(s => Math.min(s + 0.25, 3))}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setScale(s => Math.max(s - 0.25, 0.5))}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          
          <div className="ml-auto flex gap-2">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="border rounded-lg overflow-auto bg-slate-100 p-4" style={{ maxHeight: '600px' }}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="mx-auto bg-white shadow-lg cursor-crosshair"
          />
        </div>

        {/* Page Navigation */}
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}