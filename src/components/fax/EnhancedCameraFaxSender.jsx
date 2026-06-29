import { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Send, X, Loader2, RotateCw, Trash2 } from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { sendFax } from "@/functions/sendFax";
import FaxAddressBook from "./FaxAddressBook";
import FaxSignaturePanel from "./FaxSignaturePanel";
import FaxCoverSheetGenerator from "./FaxCoverSheetGenerator";

export default function EnhancedCameraFaxSender() {
  const [stream, setStream] = useState(null);
  const [capturedImages, setCapturedImages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [toNumber, setToNumber] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [coverSheetUrl, setCoverSheetUrl] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      setStream(mediaStream);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
    } catch (error) {
      toast.error("Failed to access camera: " + error.message);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  // Release the camera when the stream changes or the component unmounts, so the
  // camera isn't left live on a shared clinical device after navigating away
  // without pressing Done. (stop() on an already-stopped track is a no-op.)
  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.95);
    setCapturedImages(prev => [...prev, imageDataUrl]);
    toast.success(`Page ${capturedImages.length + 1} captured`);
  };

  const rotateImage = async (index) => {
    const img = new Image();
    img.src = capturedImages[index];
    await new Promise((resolve) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.height;
        canvas.height = img.width;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        setCapturedImages(prev => {
          const newImages = [...prev];
          newImages[index] = canvas.toDataURL("image/jpeg", 0.9);
          return newImages;
        });
        resolve();
      };
    });
  };

  const convertToPDF = async () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    for (let i = 0; i < capturedImages.length; i++) {
      const img = new Image();
      img.src = capturedImages[i];
      await new Promise((resolve) => {
        img.onload = () => {
          if (i > 0) pdf.addPage();
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = pdf.internal.pageSize.getHeight();
          const ratio = Math.min(pageWidth / img.width, pageHeight / img.height);
          const w = img.width * ratio;
          const h = img.height * ratio;
          pdf.addImage(img, "JPEG", (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
          resolve();
        };
      });
    }
    return pdf.output("blob");
  };

  const handleSendFax = async () => {
    if (capturedImages.length === 0) return toast.error("Please capture at least one photo");
    if (!toNumber.trim()) return toast.error("Please enter a recipient fax number");

    setIsSending(true);
    try {
      const pdfBlob = await convertToPDF();
      const pdfFile = new File([pdfBlob], 'camera-fax.pdf', { type: 'application/pdf' });
      let { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
      if (signatureDataUrl) {
        const result = await base44.functions.invoke('stampSignatureOnPDF', {
          pdf_url: file_url,
          signature_data_url: signatureDataUrl
        });
        file_url = result.data.file_url;
      }
      if (coverSheetUrl) {
        const merged = await base44.functions.invoke('mergePDFs', {
          pdf_urls: [coverSheetUrl, file_url]
        });
        file_url = merged.data?.merged_pdf_url || file_url;
      }
      await sendFax({ file_url, to_number: toNumber, document_name: `Camera Fax - ${capturedImages.length} page(s)` });
      toast.success("Fax sent successfully!");
      setCapturedImages([]);
      setToNumber("");
      setSignatureDataUrl(null);
      setCoverSheetUrl(null);
      stopCamera();
    } catch (error) {
      toast.error("Error sending fax: " + error.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        {/* Camera */}
        {!stream && capturedImages.length === 0 && (
          <Button onClick={startCamera} className="w-full" size="lg">
            <Camera className="w-5 h-5 mr-2" />
            Start Camera
          </Button>
        )}

        {stream && (
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden bg-black aspect-video">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            </div>
            <div className="flex gap-2">
              <Button onClick={capturePhoto} className="flex-1">
                <Camera className="w-4 h-4 mr-2" />
                Capture Page {capturedImages.length + 1}
              </Button>
              <Button onClick={stopCamera} variant="outline">
                <X className="w-4 h-4 mr-2" />
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Captured Images */}
        {capturedImages.length > 0 && !stream && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm text-slate-700">{capturedImages.length} page(s) captured</p>
              <Button onClick={startCamera} variant="outline" size="sm">
                <Camera className="w-4 h-4 mr-1" /> Add More
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {capturedImages.map((img, index) => (
                <div key={index} className="relative rounded-lg overflow-hidden border group">
                  <img src={img} alt={`Page ${index + 1}`} className="w-full" />
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button onClick={() => rotateImage(index)} variant="secondary" size="sm" className="h-7 w-7 p-0">
                      <RotateCw className="w-3 h-3" />
                    </Button>
                    <Button onClick={() => setCapturedImages(prev => prev.filter((_, i) => i !== index))} variant="destructive" size="sm" className="h-7 w-7 p-0">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="absolute bottom-1 left-1 bg-black/60 text-white px-1.5 py-0.5 rounded text-xs">p.{index + 1}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recipient */}
        {capturedImages.length > 0 && (
          <>
            <div className="space-y-2">
              <Label>Recipient Fax Number</Label>
              <Input type="tel" placeholder="+1234567890" value={toNumber} onChange={(e) => setToNumber(e.target.value)} />
              <FaxAddressBook onSelectContact={(c) => setToNumber(c.fax_number)} />
            </div>
            <FaxSignaturePanel onSignatureReady={setSignatureDataUrl} />
            <FaxCoverSheetGenerator
              recipientNumber={toNumber}
              pageCount={capturedImages.length}
              onCoverSheetReady={(url) => setCoverSheetUrl(url)}
            />
          </>
        )}

        {/* Send */}
        {capturedImages.length > 0 && (
          <Button onClick={handleSendFax} disabled={isSending || !toNumber.trim()} className="w-full" size="lg">
            {isSending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
            {isSending ? "Sending..." : "Send Fax"}
          </Button>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
}