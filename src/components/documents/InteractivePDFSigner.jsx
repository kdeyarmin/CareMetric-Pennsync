import { useRef, useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SignatureCanvas from "react-signature-canvas";
import { 
  Check, 
  Download, 
  FileText, 
  Type, 
  Calendar,
  PenTool,
  Trash2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker using reliable CDN
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

export default function InteractivePDFSigner({ 
  pdfUrl, 
  patientId, 
  documentType = "Document",
  onComplete 
}) {
  const canvasRef = useRef(null);
  const sigCanvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [isSigning, setIsSigning] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState(null);
  
  // Annotation state
  const [mode, setMode] = useState('view'); // 'view', 'text', 'signature', 'date'
  const [annotations, setAnnotations] = useState({});
  const [currentText, setCurrentText] = useState('');
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [_signatures, setSignatures] = useState({});
  const [activeSignatureId, setActiveSignatureId] = useState(null);
  
  // Load PDF
  useEffect(() => {
    const loadPDF = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        
        // Initialize annotations for all pages
        const initialAnnotations = {};
        for (let i = 1; i <= pdf.numPages; i++) {
          initialAnnotations[i] = [];
        }
        setAnnotations(initialAnnotations);
      } catch (error) {
        console.error("Error loading PDF:", error);
        toast.error("Failed to load PDF");
      }
    };
    
    if (pdfUrl) {
      loadPDF();
    }
  }, [pdfUrl]);
  
  const renderAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    const pageAnnotations = annotations[currentPage] || [];
    
    pageAnnotations.forEach(annotation => {
      // Draw selection border if annotation has id and is recent
      const isRecent = Date.now() - (annotation.id || 0) < 5000;
      if (isRecent) {
        context.strokeStyle = 'rgba(59, 130, 246, 0.5)';
        context.lineWidth = 2;
        context.setLineDash([5, 3]);
        
        if (annotation.type === 'signature') {
          context.strokeRect(annotation.x - 2, annotation.y - 2, annotation.width + 4, annotation.height + 4);
        } else {
          context.strokeRect(annotation.x - 2, annotation.y - 16, 100, 20);
        }
        context.setLineDash([]);
      }
      
      if (annotation.type === 'text') {
        context.font = `${annotation.fontSize || 14}px Arial`;
        context.fillStyle = 'black';
        context.fillText(annotation.text, annotation.x, annotation.y);
      } else if (annotation.type === 'signature' && annotation.signatureDataUrl) {
        const img = new Image();
        img.onload = () => {
          context.drawImage(img, annotation.x, annotation.y, annotation.width, annotation.height);
        };
        img.src = annotation.signatureDataUrl;
      } else if (annotation.type === 'date') {
        context.font = '12px Arial';
        context.fillStyle = 'black';
        context.fillText(`Date: ${annotation.text}`, annotation.x, annotation.y);
      }
    });
  }, [annotations, currentPage]);

  // Render current page
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return;

      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      // Render annotations on top
      renderAnnotations();
    };

    renderPage();
  }, [pdfDoc, currentPage, scale, annotations, renderAnnotations]);

  const handleCanvasClick = (e) => {
    if (mode === 'view') return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (mode === 'text') {
      if (currentText.trim()) {
        addAnnotation({
          type: 'text',
          text: currentText,
          x,
          y,
          fontSize: 14,
          page: currentPage
        });
        setCurrentText('');
        toast.success("Text added");
      } else {
        toast.error("Please enter text first");
      }
    } else if (mode === 'date') {
      const today = new Date().toLocaleDateString();
      addAnnotation({
        type: 'date',
        text: today,
        x,
        y,
        page: currentPage
      });
      toast.success("Date added");
    } else if (mode === 'signature') {
      setShowSignaturePad(true);
      setActiveSignatureId({ x, y, page: currentPage });
    }
  };
  
  const addAnnotation = (annotation) => {
    setAnnotations(prev => ({
      ...prev,
      [currentPage]: [...(prev[currentPage] || []), { ...annotation, id: Date.now() }]
    }));
  };
  
  const saveSignature = () => {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) {
      toast.error("Please provide a signature");
      return;
    }
    
    const signatureDataUrl = sigCanvasRef.current.toDataURL("image/png");
    const signatureId = Date.now();
    
    setSignatures(prev => ({
      ...prev,
      [signatureId]: signatureDataUrl
    }));
    
    if (activeSignatureId) {
      addAnnotation({
        type: 'signature',
        signatureDataUrl,
        x: activeSignatureId.x,
        y: activeSignatureId.y,
        width: 150,
        height: 50,
        page: activeSignatureId.page
      });
    }
    
    setShowSignaturePad(false);
    setActiveSignatureId(null);
    toast.success("Signature added");
  };
  
  const removeLastAnnotation = () => {
    setAnnotations(prev => ({
      ...prev,
      [currentPage]: (prev[currentPage] || []).slice(0, -1)
    }));
    toast.success("Last annotation removed");
  };
  
  const handleSubmit = async () => {
    // Check if at least one signature exists
    const hasSignature = Object.values(annotations).some(pageAnnots =>
      pageAnnots.some(a => a.type === 'signature')
    );
    
    if (!hasSignature) {
      toast.error("Please add at least one signature");
      return;
    }
    
    setIsSigning(true);
    try {
      // Send all annotations to backend for embedding
      const response = await base44.functions.invoke('embedAnnotationsToPDF', {
        pdf_url: pdfUrl,
        annotations: annotations,
        patient_id: patientId,
        document_type: documentType
      });
      
      setSignedPdfUrl(response.data.signed_pdf_url);
      
      // Update DocumentSignature status
      if (patientId && response.data.signed_pdf_url) {
        try {
          const signerEmail = (await base44.auth.me()).email;
          const signedAt = new Date().toISOString();
          const existingDocs = await base44.entities.DocumentSignature.filter({
            patient_id: patientId,
            document_url: pdfUrl,
            status: 'pending'
          });

          if (existingDocs.length > 0) {
            const doc = existingDocs[0];
            const existingSigners = Array.isArray(doc.signers) ? doc.signers : [];
            // Record the signature inside the signers[] array (schema shape);
            // there are no flat signed_at/signed_by fields.
            const updatedSigners = existingSigners.length > 0
              ? existingSigners.map((s) => ({ ...s, status: 'completed', signed_date: signedAt }))
              : [{
                  email: signerEmail,
                  role: 'patient',
                  required: true,
                  status: 'completed',
                  signed_date: signedAt,
                }];
            await base44.entities.DocumentSignature.update(doc.id, {
              signed_pdf_url: response.data.signed_pdf_url,
              status: 'completed',
              completed_date: signedAt,
              signers: updatedSigners,
            });
          }
        } catch (err) {
          console.error("Failed to update document:", err);
        }
      }
      
      toast.success("Document signed successfully!");
      
      if (onComplete) {
        onComplete(response.data.signed_pdf_url);
      }
    } catch (error) {
      console.error("Signing error:", error);
      toast.error(`Failed to sign document: ${error.message}`);
    } finally {
      setIsSigning(false);
    }
  };
  
  if (signedPdfUrl) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-600">
            <Check className="w-5 h-5" />
            Document Signed Successfully
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              onClick={() => window.open(signedPdfUrl, '_blank')}
              className="flex-1"
            >
              <FileText className="w-4 h-4 mr-2" />
              View Signed Document
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const link = document.createElement('a');
                link.href = signedPdfUrl;
                link.download = `signed-${documentType.toLowerCase().replace(/\s+/g, '-')}.pdf`;
                link.click();
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Sign Document: {documentType}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-lg border">
          <div className="flex gap-1">
            <Button
              variant={mode === 'view' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('view')}
              title="View Mode"
            >
              <FileText className="w-4 h-4" />
            </Button>
            <Button
              variant={mode === 'text' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('text')}
              title="Add Text"
            >
              <Type className="w-4 h-4" />
            </Button>
            <Button
              variant={mode === 'signature' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('signature')}
              title="Add Signature"
            >
              <PenTool className="w-4 h-4" />
            </Button>
            <Button
              variant={mode === 'date' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('date')}
              title="Add Date"
            >
              <Calendar className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="h-6 w-px bg-slate-300" />
          
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScale(s => Math.min(3, s + 0.25))}
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="h-6 w-px bg-slate-300" />
          
          <Button
            variant="outline"
            size="sm"
            onClick={removeLastAnnotation}
            title="Remove Last"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        
        {/* Text Input for Text Mode */}
        {mode === 'text' && (
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <Label>Enter text then click on PDF to place it:</Label>
            <Input
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              placeholder="Type your text here..."
              className="mt-2"
            />
          </div>
        )}
        
        {/* Mode Instructions */}
        {mode !== 'view' && mode !== 'text' && (
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-900 font-medium mb-1">
              {mode === 'signature' && "✍️ Multiple Signatures Supported"}
              {mode === 'date' && "📅 Add Dates Anywhere"}
            </p>
            <p className="text-xs text-blue-700">
              {mode === 'signature' && "Click anywhere on the PDF to add signatures. You can place multiple signatures on the same page or across different pages."}
              {mode === 'date' && "Click on the PDF where you want to add today's date. You can add multiple dates."}
            </p>
          </div>
        )}
        
        {/* PDF Canvas */}
        <div 
          ref={containerRef}
          className="border rounded-lg overflow-auto bg-slate-100 max-h-[600px]"
          style={{ cursor: mode !== 'view' ? 'crosshair' : 'default' }}
        >
          <canvas 
            ref={canvasRef} 
            onClick={handleCanvasClick}
            className="mx-auto"
          />
        </div>
        
        {/* Page Navigation & Annotation Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            
            <div className="text-center">
              <span className="text-sm text-slate-600">
                Page {currentPage} of {numPages}
              </span>
              <div className="text-xs text-slate-500 mt-1">
                {(annotations[currentPage] || []).length} annotation{(annotations[currentPage] || []).length !== 1 ? 's' : ''} on this page
              </div>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              disabled={currentPage === numPages}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          
          {/* Total Annotations Summary */}
          <div className="flex justify-center gap-4 text-xs text-slate-600 p-2 bg-slate-50 rounded">
            <span>
              Total Signatures: {Object.values(annotations).flat().filter(a => a.type === 'signature').length}
            </span>
            <span>•</span>
            <span>
              Total Annotations: {Object.values(annotations).flat().length}
            </span>
          </div>
        </div>
        
        {/* Signature Pad Dialog */}
        {showSignaturePad && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Draw Your Signature</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-slate-300 rounded-lg bg-white">
                  <SignatureCanvas
                    ref={sigCanvasRef}
                    canvasProps={{
                      className: 'w-full h-48',
                      style: { touchAction: 'none' }
                    }}
                    backgroundColor="white"
                  />
                </div>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      sigCanvasRef.current?.clear();
                    }}
                    className="flex-1"
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowSignaturePad(false);
                      setActiveSignatureId(null);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={saveSignature}
                    className="flex-1"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={isSigning}
          className="w-full bg-green-600 hover:bg-green-700"
          size="lg"
        >
          {isSigning ? (
            <>Processing...</>
          ) : (
            <>
              <Check className="w-4 h-4 mr-2" />
              Complete & Submit Document
            </>
          )}
        </Button>
        
        <p className="text-xs text-slate-500 text-center">
          By signing, you acknowledge that you have read and agree to the terms outlined in this document.
        </p>
      </CardContent>
    </Card>
  );
}