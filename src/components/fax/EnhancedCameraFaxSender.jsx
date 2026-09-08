import { useState, useRef, useLayoutEffect } from "react";
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
import FaxCoverSheetGenerator from "./FaxCoverSheetGenerator";
import { getAuthorityBoundUserMedia, stopMediaStream } from '@/lib/tenantMediaDevices';
import {
  createAuthorityBoundMediaOperation,
  detachAuthorityBoundMediaTree,
  loadAuthorityBoundImage,
} from '@/lib/authorityBoundMediaProcessing';

export default function EnhancedCameraFaxSender() {
  const [stream, setStream] = useState(null);
  const [capturedImages, setCapturedImages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [toNumber, setToNumber] = useState("");
  const [coverSheetUrl, setCoverSheetUrl] = useState(null);
  const [authorityReady, setAuthorityReady] = useState(false);
  const rootRef = useRef(null);
  const cameraContainerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(false);
  const authorityRef = useRef(null);
  const operationsRef = useRef(new Set());
  const mediaAcquisitionRef = useRef(0);

  const authorityIsCurrent = (authority = authorityRef.current) => (
    mountedRef.current
    && authorityRef.current === authority
    && authority?.isCurrent()
  );

  const beginOperation = () => {
    const authority = authorityRef.current;
    if (!authorityIsCurrent(authority)) return null;
    try {
      const operation = createAuthorityBoundMediaOperation(authority.realmLease);
      operationsRef.current.add(operation);
      return operation;
    } catch {
      return null;
    }
  };

  const finishOperation = (operation) => {
    if (!operation) return;
    operationsRef.current.delete(operation);
    operation.dispose();
  };

  useLayoutEffect(() => {
    mountedRef.current = true;
    let authority;
    try {
      authority = createAuthorityBoundMediaOperation();
    } catch {
      setAuthorityReady(false);
      return () => { mountedRef.current = false; };
    }

    const revoke = () => {
      if (authorityRef.current === authority) authorityRef.current = null;
      mediaAcquisitionRef.current += 1;
      for (const operation of operationsRef.current) operation.dispose();
      operationsRef.current.clear();
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      detachAuthorityBoundMediaTree(rootRef.current);
      if (!mountedRef.current) return;
      setAuthorityReady(false);
      setStream(null);
      setCapturedImages([]);
      setIsSending(false);
      setToNumber("");
      setCoverSheetUrl(null);
    };

    authorityRef.current = authority;
    authority.addTeardown(revoke);
    if (authority.isCurrent()) setAuthorityReady(true);
    else revoke();

    return () => {
      mountedRef.current = false;
      if (authorityRef.current === authority) authorityRef.current = null;
      authority.dispose();
      revoke();
    };
  }, []);

  const startCamera = async () => {
    const authority = authorityRef.current;
    if (!authorityIsCurrent(authority)) return;
    const acquisition = ++mediaAcquisitionRef.current;
    let acquiredStream = null;
    try {
      authority.assertCurrent();
      const { realmLease, stream: mediaStream } = await getAuthorityBoundUserMedia({
        video: { 
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      acquiredStream = mediaStream;
      if (
        !authorityIsCurrent(authority)
        || realmLease !== authority.realmLease
        || acquisition !== mediaAcquisitionRef.current
      ) {
        stopMediaStream(mediaStream);
        return;
      }
      streamRef.current = mediaStream;
      setStream(mediaStream);
    } catch (error) {
      stopMediaStream(acquiredStream);
      if (streamRef.current === acquiredStream) streamRef.current = null;
      if (
        authorityIsCurrent(authority)
        && acquisition === mediaAcquisitionRef.current
      ) {
        toast.error("Failed to access camera: " + error.message);
      }
    }
  };

  const stopCamera = () => {
    mediaAcquisitionRef.current += 1;
    stopMediaStream(streamRef.current || stream);
    streamRef.current = null;
    detachAuthorityBoundMediaTree(cameraContainerRef.current);
    if (authorityIsCurrent()) setStream(null);
  };

  // Bind the stream to the <video> element once both exist. The video is only
  // mounted after `stream` state is set, so it can't be attached inline in
  // startCamera (videoRef.current is still null at that point).
  useLayoutEffect(() => {
    const video = videoRef.current;
    const cameraContainer = cameraContainerRef.current;
    const authority = authorityRef.current;
    if (video && stream && authorityIsCurrent(authority)) video.srcObject = stream;
    else detachAuthorityBoundMediaTree(cameraContainer);
    return () => detachAuthorityBoundMediaTree(cameraContainer);
  }, [stream]);

  const capturePhoto = () => {
    const authority = authorityRef.current;
    if (!authorityIsCurrent(authority)) return;
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.95);
    if (!authorityIsCurrent(authority)) return;
    setCapturedImages(prev => (
      authorityIsCurrent(authority) ? [...prev, imageDataUrl] : prev
    ));
    if (authorityIsCurrent(authority)) {
      toast.success(`Page ${capturedImages.length + 1} captured`);
    }
  };

  const rotateImage = async (index) => {
    const authority = authorityRef.current;
    const source = capturedImages[index];
    const operation = source ? beginOperation() : null;
    if (!operation || !authorityIsCurrent(authority)) return;
    try {
      const image = await loadAuthorityBoundImage(operation, source);
      operation.assertCurrent();
      const canvas = document.createElement('canvas');
      operation.addTeardown(() => {
        canvas.width = 0;
        canvas.height = 0;
      });
      canvas.width = image.height;
      canvas.height = image.width;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image rotation is unavailable');
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(Math.PI / 2);
      context.drawImage(image, -image.width / 2, -image.height / 2);
      const rotatedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      operation.assertCurrent();
      if (!authorityIsCurrent(authority)) return;
      setCapturedImages(prev => {
        if (!authorityIsCurrent(authority) || prev[index] !== source) return prev;
        const newImages = [...prev];
        newImages[index] = rotatedDataUrl;
        return newImages;
      });
    } catch (error) {
      if (authorityIsCurrent(authority)) {
        toast.error("Failed to rotate image: " + error.message);
      }
    } finally {
      finishOperation(operation);
    }
  };

  const convertToPDF = async (operation, images) => {
    operation.assertCurrent();
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    for (let i = 0; i < images.length; i++) {
      operation.assertCurrent();
      const image = await loadAuthorityBoundImage(operation, images[i]);
      operation.assertCurrent();
      if (i > 0) pdf.addPage();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      pdf.addImage(
        image,
        "JPEG",
        (pageWidth - width) / 2,
        (pageHeight - height) / 2,
        width,
        height,
      );
    }
    operation.assertCurrent();
    return pdf.output("blob");
  };

  const handleSendFax = async () => {
    const authority = authorityRef.current;
    if (!authorityIsCurrent(authority)) return;
    if (capturedImages.length === 0) return toast.error("Please capture at least one photo");
    if (!toNumber.trim()) return toast.error("Please enter a recipient fax number");

    const operation = beginOperation();
    if (!operation || !authorityIsCurrent(authority)) return;
    const images = [...capturedImages];
    const recipientNumber = toNumber;
    const coverSheet = coverSheetUrl;
    setIsSending(true);
    try {
      const pdfBlob = await convertToPDF(operation, images);
      operation.assertCurrent();
      const pdfFile = new File([pdfBlob], 'camera-fax.pdf', { type: 'application/pdf' });
      operation.assertCurrent();
      let { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
      operation.assertCurrent();
      if (coverSheet) {
        operation.assertCurrent();
        const merged = await base44.functions.invoke('mergePDFs', {
          pdf_urls: [coverSheet, file_url]
        });
        operation.assertCurrent();
        file_url = merged.data?.merged_pdf_url || file_url;
      }
      operation.assertCurrent();
      await sendFax({
        file_url,
        to_number: recipientNumber,
        document_name: `Camera Fax - ${images.length} page(s)`,
      });
      operation.assertCurrent();
      if (!authorityIsCurrent(authority)) return;
      toast.success("Fax sent successfully!");
      setCapturedImages([]);
      setToNumber("");
      setCoverSheetUrl(null);
      stopCamera();
    } catch (error) {
      if (authorityIsCurrent(authority)) {
        toast.error("Error sending fax: " + error.message);
      }
    } finally {
      if (authorityIsCurrent(authority)) setIsSending(false);
      finishOperation(operation);
    }
  };

  return (
    <Card ref={rootRef}>
      <CardContent className="pt-6 space-y-5">
        {/* Camera */}
        {!stream && capturedImages.length === 0 && (
          <Button onClick={startCamera} disabled={!authorityReady} className="w-full" size="lg">
            <Camera className="w-5 h-5 mr-2" />
            Start Camera
          </Button>
        )}

        {stream && (
          <div className="space-y-3">
            <div ref={cameraContainerRef} className="rounded-lg overflow-hidden bg-black aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                controls={false}
                controlsList="nodownload nofullscreen noremoteplayback"
                disablePictureInPicture
                disableRemotePlayback
                {...{ "x-webkit-airplay": "deny" }}
                draggable={false}
                tabIndex={-1}
                onContextMenu={(event) => event.preventDefault()}
                onDragStart={(event) => event.preventDefault()}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={capturePhoto} disabled={!authorityReady} className="flex-1">
                <Camera className="w-4 h-4 mr-2" />
                Capture Page {capturedImages.length + 1}
              </Button>
              <Button onClick={stopCamera} disabled={!authorityReady} variant="outline">
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
              <Button onClick={startCamera} disabled={!authorityReady} variant="outline" size="sm">
                <Camera className="w-4 h-4 mr-1" /> Add More
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {capturedImages.map((img, index) => (
                <div key={index} className="relative rounded-lg overflow-hidden border group">
                  <img
                    src={authorityReady ? img : undefined}
                    alt={`Page ${index + 1}`}
                    draggable={false}
                    onContextMenu={(event) => event.preventDefault()}
                    onDragStart={(event) => event.preventDefault()}
                    className="w-full"
                  />
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button disabled={!authorityReady} onClick={() => rotateImage(index)} variant="secondary" size="sm" className="h-7 w-7 p-0">
                      <RotateCw className="w-3 h-3" />
                    </Button>
                    <Button
                      disabled={!authorityReady}
                      onClick={() => {
                        const authority = authorityRef.current;
                        if (!authorityIsCurrent(authority)) return;
                        setCapturedImages(prev => (
                          authorityIsCurrent(authority)
                            ? prev.filter((_, imageIndex) => imageIndex !== index)
                            : prev
                        ));
                      }}
                      variant="destructive"
                      size="sm"
                      className="h-7 w-7 p-0"
                    >
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
              <Input
                type="tel"
                placeholder="+1234567890"
                value={toNumber}
                disabled={!authorityReady}
                onChange={(event) => {
                  if (authorityIsCurrent()) setToNumber(event.target.value);
                }}
              />
              <FaxAddressBook onSelectContact={(contact) => {
                if (authorityIsCurrent()) setToNumber(contact.fax_number);
              }} />
            </div>
            <FaxCoverSheetGenerator
              recipientNumber={toNumber}
              pageCount={capturedImages.length}
              onCoverSheetReady={(url) => {
                if (authorityIsCurrent()) setCoverSheetUrl(url);
              }}
            />
          </>
        )}

        {/* Send */}
        {capturedImages.length > 0 && (
          <Button onClick={handleSendFax} disabled={!authorityReady || isSending || !toNumber.trim()} className="w-full" size="lg">
            {isSending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
            {isSending ? "Sending..." : "Send Fax"}
          </Button>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
}
