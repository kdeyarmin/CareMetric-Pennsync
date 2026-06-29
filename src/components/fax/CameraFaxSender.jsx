import { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Send, X, Loader2, BookUser, FileText } from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import { sendFax } from "@/functions/sendFax";
import FaxAddressBook from "./FaxAddressBook";
import AICoverPageEditor from "./AICoverPageEditor";
import { Checkbox } from "@/components/ui/checkbox";

export default function CameraFaxSender() {
  const [stream, setStream] = useState(null);
  const [capturedImages, setCapturedImages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [toNumber, setToNumber] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [includeCoverPage, setIncludeCoverPage] = useState(false);
  const [aiCoverPageData, setAiCoverPageData] = useState(null);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
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

  // Release the camera when the stream changes or the component unmounts, so it
  // isn't left live on a shared device after navigating away. (stop() on an
  // already-stopped track is a no-op.)
  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImages(prev => [...prev, imageDataUrl]);
    toast.success(`Photo ${capturedImages.length + 1} captured`);
  };

  const removeImage = (index) => {
    setCapturedImages(prev => prev.filter((_, i) => i !== index));
  };

  const generateCoverPagePDF = (coverPageData) => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    
    pdf.setFontSize(18);
    pdf.text("FAX COVER PAGE", pageWidth / 2, 20, { align: 'center' });
    
    pdf.setFontSize(10);
    let y = 40;
    
    pdf.text(`Date: ${coverPageData.date}`, 20, y);
    y += 10;
    pdf.text(`From: ${coverPageData.from.name} (${coverPageData.from.phone})`, 20, y);
    y += 8;
    pdf.text(`To: ${coverPageData.to.name} (${coverPageData.to.fax})`, 20, y);
    y += 15;
    
    pdf.setFontSize(12);
    pdf.text(`Subject: ${coverPageData.subject}`, 20, y);
    y += 12;
    
    if (coverPageData.patient_info?.name) {
      pdf.setFontSize(11);
      pdf.text('Patient Information:', 20, y);
      y += 7;
      pdf.setFontSize(9);
      pdf.text(`Name: ${coverPageData.patient_info.name}`, 25, y);
      y += 5;
      if (coverPageData.patient_info.dob) {
        pdf.text(`DOB: ${coverPageData.patient_info.dob}`, 25, y);
        y += 5;
      }
      if (coverPageData.patient_info.mrn) {
        pdf.text(`MRN: ${coverPageData.patient_info.mrn}`, 25, y);
        y += 5;
      }
      y += 5;
    }
    
    if (coverPageData.message) {
      pdf.setFontSize(11);
      pdf.text('Notes:', 20, y);
      y += 7;
      pdf.setFontSize(9);
      const lines = pdf.splitTextToSize(coverPageData.message, pageWidth - 40);
      pdf.text(lines, 25, y);
    }
    
    return pdf;
  };

  const convertToPDF = async (includeCover = false) => {
    let pdf;
    
    if (includeCover && aiCoverPageData) {
      pdf = generateCoverPagePDF(aiCoverPageData);
    } else {
      pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    }
    
    for (let i = 0; i < capturedImages.length; i++) {
      const img = new Image();
      img.src = capturedImages[i];
      
      await new Promise((resolve) => {
        img.onload = () => {
          if (includeCover || i > 0) pdf.addPage();
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = pdf.internal.pageSize.getHeight();
          const ratio = Math.min(pageWidth / img.width, pageHeight / img.height);
          const width = img.width * ratio;
          const height = img.height * ratio;
          const x = (pageWidth - width) / 2;
          const y = (pageHeight - height) / 2;
          pdf.addImage(img, "JPEG", x, y, width, height);
          resolve();
        };
      });
    }
    
    return pdf.output("blob");
  };

  const handleSendFax = async () => {
    if (capturedImages.length === 0 && !includeCoverPage) {
      toast.error("Please capture at least one photo or enable cover page");
      return;
    }
    if (!toNumber || !fromNumber) {
      toast.error("Please enter both phone numbers");
      return;
    }
    if (includeCoverPage && !aiCoverPageData) {
      toast.error("Please wait for AI cover page to generate");
      return;
    }

    setIsSending(true);

    try {
      const pdfBlob = await convertToPDF(includeCoverPage);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfBlob });

      const totalPages = capturedImages.length + (includeCoverPage ? 1 : 0);
      const response = await sendFax({
        file_url,
        to_number: toNumber,
        from_number: fromNumber,
        document_name: `Camera Fax - ${totalPages} page(s)`,
        cover_page_details: includeCoverPage ? aiCoverPageData : null
      });

      if (response.data.success) {
        toast.success(`Fax sent successfully! ${totalPages} page(s)`);
        setCapturedImages([]);
        setToNumber("");
        setFromNumber("");
        setIncludeCoverPage(false);
        setAiCoverPageData(null);
        stopCamera();
      } else {
        throw new Error(response.data.error || "Failed to send fax");
      }
    } catch (error) {
      toast.error("Error sending fax: " + error.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="w-5 h-5" />
          Camera to Fax
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* No Camera Active */}
        {!stream && capturedImages.length === 0 && (
          <Button onClick={startCamera} className="w-full" size="lg">
            <Camera className="w-5 h-5 mr-2" />
            Start Camera
          </Button>
        )}

        {/* Camera View */}
        {stream && (
          <div className="space-y-4">
            <div className="relative bg-black rounded-lg overflow-hidden">
              <video ref={videoRef} autoPlay playsInline className="w-full" />
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

        {/* Captured Images Preview */}
        {capturedImages.length > 0 && !stream && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">{capturedImages.length} page(s) captured</p>
              <Button onClick={startCamera} variant="outline" size="sm">
                <Camera className="w-4 h-4 mr-2" />
                Add More Pages
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {capturedImages.map((img, index) => (
                <div key={index} className="relative rounded-lg overflow-hidden border-2 border-slate-200 group">
                  <img src={img} alt={`Page ${index + 1}`} className="w-full" />
                  <div className="absolute top-2 right-2">
                    <Button
                      onClick={() => removeImage(index)}
                      variant="destructive"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="absolute bottom-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                    Page {index + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fax Details */}
        {(capturedImages.length > 0 || includeCoverPage) && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="includeCoverPage"
                checked={includeCoverPage}
                onCheckedChange={setIncludeCoverPage}
              />
              <Label htmlFor="includeCoverPage" className="text-sm font-medium flex items-center gap-1 cursor-pointer">
                <FileText className="w-4 h-4" /> Include AI Cover Page
              </Label>
            </div>

            {includeCoverPage && (
              <AICoverPageEditor 
                recipientNumber={toNumber}
                senderNumber={fromNumber}
                onCoverPageGenerated={setAiCoverPageData}
              />
            )}

            <Tabs defaultValue="manual" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                <TabsTrigger value="addressbook">
                  <BookUser className="w-4 h-4 mr-2" />
                  Address Book
                </TabsTrigger>
              </TabsList>
              <TabsContent value="manual" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="from-number">From Number</Label>
                  <Input
                    id="from-number"
                    type="tel"
                    placeholder="+1234567890"
                    value={fromNumber}
                    onChange={(e) => setFromNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to-number">To Number</Label>
                  <Input
                    id="to-number"
                    type="tel"
                    placeholder="+1234567890"
                    value={toNumber}
                    onChange={(e) => setToNumber(e.target.value)}
                  />
                </div>
              </TabsContent>
              <TabsContent value="addressbook" className="mt-4">
                <FaxAddressBook
                  onSelectContact={(contact) => {
                    setToNumber(contact.fax_number);
                    toast.success(`Selected ${contact.name}`);
                  }}
                />
              </TabsContent>
            </Tabs>
            <Button
              onClick={handleSendFax}
              disabled={isSending}
              className="w-full"
              size="lg"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Sending Fax...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5 mr-2" />
                  Send Fax
                </>
              )}
            </Button>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
}