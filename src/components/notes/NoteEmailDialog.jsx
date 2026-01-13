import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Send, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function NoteEmailDialog({ 
  noteContent, 
  patientData,
  visitType,
  currentUser
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [providerEmail, setProviderEmail] = useState(currentUser?.email || "");
  const [patientEmail, setPatientEmail] = useState(patientData?.email || "");
  const [sentTo, setSentTo] = useState(null);

  const handleSendEmail = async (recipientType) => {
    const recipientEmail = recipientType === 'provider' ? providerEmail : patientEmail;
    
    if (!recipientEmail) {
      toast.error('Please enter an email address');
      return;
    }

    setIsSending(true);

    try {
      const response = await base44.functions.invoke('sendNoteEmail', {
        noteContent,
        recipientEmail,
        recipientType,
        patientName: patientData ? `${patientData.first_name} ${patientData.last_name}` : null,
        visitType: visitType?.replace(/_/g, ' ')
      });

      const data = response.data || response;

      if (data.success) {
        setSentTo(recipientEmail);
        toast.success(`Note sent to ${recipientEmail}`);
        setTimeout(() => {
          setSentTo(null);
          setIsOpen(false);
        }, 2000);
      } else {
        throw new Error(data.error || 'Failed to send');
      }
    } catch (error) {
      toast.error(`Failed to send: ${error.message}`);
    }

    setIsSending(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Mail className="w-4 h-4" />
          Email Note
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            Email Clinical Note
          </DialogTitle>
        </DialogHeader>

        {sentTo ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-3 text-green-600" />
            <p className="text-sm font-medium text-gray-900">Email sent successfully!</p>
            <p className="text-xs text-gray-600 mt-1">{sentTo}</p>
          </div>
        ) : (
          <Tabs defaultValue="provider" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="provider">To Myself</TabsTrigger>
              <TabsTrigger value="patient">To Patient</TabsTrigger>
            </TabsList>

            <TabsContent value="provider" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="provider-email">Your Email</Label>
                <Input
                  id="provider-email"
                  type="email"
                  placeholder="your@email.com"
                  value={providerEmail}
                  onChange={(e) => setProviderEmail(e.target.value)}
                />
                <p className="text-xs text-gray-600">
                  Full clinical note will be sent
                </p>
              </div>
              <Button
                onClick={() => handleSendEmail('provider')}
                disabled={isSending || !providerEmail}
                className="w-full"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send to Myself
                  </>
                )}
              </Button>
            </TabsContent>

            <TabsContent value="patient" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="patient-email">Patient Email</Label>
                <Input
                  id="patient-email"
                  type="email"
                  placeholder="patient@email.com"
                  value={patientEmail}
                  onChange={(e) => setPatientEmail(e.target.value)}
                />
                <p className="text-xs text-gray-600">
                  Patient-friendly summary will be sent
                </p>
              </div>
              <Button
                onClick={() => handleSendEmail('patient')}
                disabled={isSending || !patientEmail}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send to Patient
                  </>
                )}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}