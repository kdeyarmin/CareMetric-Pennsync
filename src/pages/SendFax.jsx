import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Send, Phone, Loader2, CheckCircle2, WifiOff, Wifi, FileText } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import FaxInstructions from "@/components/fax/FaxInstructions";
import FaxAddressBook from "@/components/fax/FaxAddressBook";
import FaxCoverSheet from "@/components/fax/FaxCoverSheet";
import FaxDocumentUploader from "@/components/fax/FaxDocumentUploader";
import FaxHistoryList from "@/components/fax/FaxHistory";
import AIFaxAssistant from "@/components/fax/AIFaxAssistant";
import { generateCoverSheetPDF } from "@/components/fax/CoverSheetPDFGenerator";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

export default function SendFax() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [sending, setSending] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientFax, setRecipientFax] = useState("");
  const [usePersonalFaxNumber, setUsePersonalFaxNumber] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [includeCover, setIncludeCover] = useState(true);
  const [coverData, setCoverData] = useState({
    sender_name: "",
    sender_company: "",
    sender_phone: "",
    subject: "",
    message: "",
    urgency: "normal",
    include_hipaa: true
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  // Auto-fill sender from user profile and set default sending fax number
  useEffect(() => {
    if (currentUser) {
      setCoverData(prev => ({
        ...prev,
        sender_name: prev.sender_name || currentUser.full_name || "",
      }));
      if (currentUser.sending_fax_number) {
        setUsePersonalFaxNumber(true);
      }
    }
  }, [currentUser]);

  // Online/offline detection
  useEffect(() => {
    const goOnline = () => { setIsOnline(true); processQueue(); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Process queued faxes when coming online
  const processQueue = async () => {
    if (!currentUser?.email) return;
    try {
      const queued = await base44.entities.FaxHistory.filter({ user_email: currentUser.email, status: 'queued' });
      for (const fax of queued) {
        if (fax.document_urls?.length > 0) {
          try {
            await base44.functions.invoke('sendFax', {
              to_fax_number: fax.recipient_fax_number,
              media_urls: fax.document_urls,
              fax_history_id: fax.id
            });
            toast.success(`Queued fax to ${fax.recipient_name || fax.recipient_fax_number} is now sending`);
          } catch (err) {
            console.error("Failed to send queued fax:", err);
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ['faxHistory'] });
    } catch (err) {
      console.error("Error processing queue:", err);
    }
  };

  const handleSelectContact = (contact) => {
    setRecipientName(contact.name);
    setRecipientFax(contact.fax_number);
    if (contact.company) {
      setRecipientName(`${contact.name} - ${contact.company}`);
    }
  };

  const handleSendFax = async () => {
    if (!recipientFax.trim()) {
      toast.error("Please enter a fax number");
      return;
    }
    if (documents.length === 0 && !includeCover) {
      toast.error("Please attach at least one document or include a cover sheet");
      return;
    }

    setSending(true);

    try {
      // Build media URLs
      let mediaUrls = [];

      // Generate cover sheet PDF if included
      if (includeCover) {
        const coverPDF = await generateCoverSheetPDF(coverData, recipientName, recipientFax);
        const { file_url } = await base44.integrations.Core.UploadFile({ file: coverPDF });
        mediaUrls.push(file_url);
      }

      // Add document URLs
      documents.forEach(doc => mediaUrls.push(doc.url));

      // Create fax history record
      const historyRecord = await base44.entities.FaxHistory.create({
        user_email: currentUser.email,
        recipient_name: recipientName,
        recipient_fax_number: recipientFax,
        subject: coverData.subject,
        cover_sheet_message: coverData.message,
        document_urls: mediaUrls,
        page_count: mediaUrls.length,
        status: isOnline ? 'sending' : 'queued'
      });

      if (!isOnline) {
        toast.info("You're offline. Fax has been queued and will send when you reconnect.");
        resetForm();
        setSending(false);
        queryClient.invalidateQueries({ queryKey: ['faxHistory'] });
        return;
      }

      // Send via backend
      const { data } = await base44.functions.invoke('sendFax', {
        to_fax_number: recipientFax,
        media_urls: mediaUrls,
        fax_history_id: historyRecord.id,
        from_fax_number: usePersonalFaxNumber ? currentUser.sending_fax_number : undefined
      });

      if (data?.success) {
        toast.success("Fax sent successfully!");
        resetForm();
      } else {
        toast.error(data?.error || "Failed to send fax");
      }

      queryClient.invalidateQueries({ queryKey: ['faxHistory'] });
    } catch (error) {
      console.error("Fax send error:", error);
      toast.error("Failed to send fax: " + (error.message || "Unknown error"));
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setRecipientName("");
    setRecipientFax("");
    setDocuments([]);
    setCoverData(prev => ({ ...prev, subject: "", message: "" }));
  };

  // Count queued faxes
  const { data: queuedCount = 0 } = useQuery({
    queryKey: ['queuedFaxCount', currentUser?.email],
    queryFn: async () => {
      const queued = await base44.entities.FaxHistory.filter({ user_email: currentUser.email, status: 'queued' });
      return queued.length;
    },
    enabled: !!currentUser?.email,
    refetchInterval: 15000
  });

  const agencyId = currentUser?.agency_id;

  return (
    <PremiumFeatureGate featureName="Send a Fax" featureDescription="Send faxes directly from the app with camera-to-PDF conversion and address book." allowTrial={true}>
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto pb-20 sm:pb-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Send className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            Send a Fax
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">Send documents via fax directly from CareMetric AI</p>
        </div>
        <div className="flex items-center gap-2">
          {queuedCount > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 text-xs">
              {queuedCount} queued
            </Badge>
          )}
          <Badge className={`text-xs ${isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {isOnline ? <><Wifi className="w-3 h-3 mr-1" /> Online</> : <><WifiOff className="w-3 h-3 mr-1" /> Offline</>}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-4">
          {/* Address Book at Top */}
          <FaxAddressBook
            userEmail={currentUser?.email}
            agencyId={agencyId}
            onSelectContact={handleSelectContact}
          />

          {/* Recipient */}
          <Card>
            <CardHeader className="pb-2 p-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Recipient
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Recipient Name</Label>
                  <Input
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="Dr. Smith - Memorial Hospital"
                    className="h-10 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Fax Number *</Label>
                  <Input
                    value={recipientFax}
                    onChange={e => setRecipientFax(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="h-10 text-sm"
                    type="tel"
                  />
                </div>
              </div>
              {currentUser?.sending_fax_number && (
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <input
                    type="checkbox"
                    checked={usePersonalFaxNumber}
                    onChange={e => setUsePersonalFaxNumber(e.target.checked)}
                    className="rounded"
                  />
                  <Label className="text-xs text-slate-600">
                    Send from my fax number: <span className="font-semibold">{currentUser.sending_fax_number}</span>
                  </Label>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cover Sheet */}
          <div className="flex items-center gap-2 mb-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={includeCover} onChange={e => setIncludeCover(e.target.checked)} className="rounded" />
              Include Cover Sheet
            </label>
          </div>
          {includeCover && (
            <FaxCoverSheet
              userEmail={currentUser?.email}
              coverData={coverData}
              onCoverDataChange={setCoverData}
              recipientName={recipientName}
              recipientFax={recipientFax}
            />
          )}

          {/* Document Upload */}
          <FaxDocumentUploader
            documents={documents}
            onDocumentsChange={setDocuments}
            onDocumentAnalysis={(index, analysis) => {
              // Auto-fill cover sheet subject from first analyzed document if empty
              if (includeCover && !coverData.subject && analysis.document_type) {
                const parts = [];
                if (analysis.document_type) parts.push(analysis.document_type);
                if (analysis.patient_name) parts.push(`Patient: ${analysis.patient_name}`);
                if (analysis.date_of_service) parts.push(analysis.date_of_service);
                setCoverData(prev => ({
                  ...prev,
                  subject: prev.subject || parts.join(' - ')
                }));
              }
            }}
          />

          {/* AI Assistant */}
          <AIFaxAssistant
            documents={documents}
            coverData={coverData}
            onCoverDataChange={setCoverData}
            recipientName={recipientName}
            recipientFax={recipientFax}
          />

          {/* Send Button */}
          <Button
            onClick={handleSendFax}
            disabled={sending || (!recipientFax.trim()) || (documents.length === 0 && !includeCover)}
            className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white text-base"
            size="lg"
          >
            {sending ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                {isOnline ? 'Sending Fax...' : 'Queuing Fax...'}
              </>
            ) : (
              <>
                <Send className="w-5 h-5 mr-2" />
                {isOnline ? 'Send Fax' : 'Queue Fax (Offline)'}
              </>
            )}
          </Button>

          {!isOnline && (
            <Alert className="bg-amber-50 border-amber-200">
              <WifiOff className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800">
                Your fax will be saved and sent automatically when you're back online.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Tabs defaultValue="history">
            <TabsList className="grid w-full grid-cols-2 mb-2">
              <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
              <TabsTrigger value="help" className="text-xs">Help</TabsTrigger>
            </TabsList>

            <TabsContent value="history">
              <FaxHistoryList userEmail={currentUser?.email} />
            </TabsContent>

            <TabsContent value="help">
              <FaxInstructions isOnline={isOnline} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
    </PremiumFeatureGate>
  );
}