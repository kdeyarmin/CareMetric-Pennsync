import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const EHR_SYSTEMS = [
  { id: 'epic', name: 'Epic', color: 'bg-blue-600', integration: 'epicIntegration' },
  { id: 'cerner', name: 'Cerner/Oracle Health', color: 'bg-orange-600', integration: 'cernerIntegration' },
  { id: 'athena', name: 'Athenahealth', color: 'bg-green-600', integration: 'athenaIntegration' }
];

export default function EHRPushButton({ 
  noteContent, 
  patientMRN,
  patientData,
  encounterDate,
  noteType = "Clinical Note"
}) {
  const [selectedEHR, setSelectedEHR] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handlePushToEHR = async () => {
    if (!selectedEHR) {
      toast.error("Select an EHR system");
      return;
    }

    if (!noteContent) {
      toast.error("No note content to push");
      return;
    }

    const ehr = EHR_SYSTEMS.find(e => e.id === selectedEHR);
    setIsPushing(true);

    try {
      const response = await base44.functions.invoke(ehr.integration, {
        noteContent,
        patientMRN: patientMRN || patientData?.medical_record_number,
        encounterDate: encounterDate || new Date().toISOString().split('T')[0],
        noteType,
        patientName: patientData ? `${patientData.first_name} ${patientData.last_name}` : null
      });

      const data = response.data || response;

      if (data.success) {
        setPushSuccess(true);
        toast.success(`Note pushed to ${ehr.name} successfully!`);
        setTimeout(() => {
          setPushSuccess(false);
          setIsOpen(false);
        }, 2000);
      } else {
        throw new Error(data.error || 'Push failed');
      }
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      
      if (errorMsg.includes('not configured')) {
        toast.error(`${ehr.name} integration not set up. Contact your administrator.`);
      } else {
        toast.error(`Failed to push to ${ehr.name}: ${errorMsg}`);
      }
    }

    setIsPushing(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          className="gap-2 border-2 border-blue-300 hover:bg-blue-50"
        >
          <Upload className="w-4 h-4" />
          Push to EHR
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="w-5 h-5 text-blue-600" />
            Push Note to EHR
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* EHR System Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">Select EHR System</label>
            <Select value={selectedEHR} onValueChange={setSelectedEHR}>
              <SelectTrigger>
                <SelectValue placeholder="Choose your EHR..." />
              </SelectTrigger>
              <SelectContent>
                {EHR_SYSTEMS.map(ehr => (
                  <SelectItem key={ehr.id} value={ehr.id}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${ehr.color}`} />
                      {ehr.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Patient Info */}
          {patientData && (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-xs">
                <strong>Patient:</strong> {patientData.first_name} {patientData.last_name}<br />
                <strong>MRN:</strong> {patientMRN || patientData.medical_record_number || 'Not provided'}<br />
                <strong>Date:</strong> {encounterDate || 'Today'}
              </AlertDescription>
            </Alert>
          )}

          {/* Push Button */}
          {!pushSuccess ? (
            <Button
              onClick={handlePushToEHR}
              disabled={isPushing || !selectedEHR || !noteContent}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isPushing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Pushing to {EHR_SYSTEMS.find(e => e.id === selectedEHR)?.name}...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Push Note to {selectedEHR ? EHR_SYSTEMS.find(e => e.id === selectedEHR)?.name : 'EHR'}
                </>
              )}
            </Button>
          ) : (
            <Alert className="bg-green-100 border-green-300">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-sm text-green-900">
                Note successfully pushed to {EHR_SYSTEMS.find(e => e.id === selectedEHR)?.name}!
              </AlertDescription>
            </Alert>
          )}

          {/* Setup Notice */}
          <Alert className="bg-amber-50 border-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-xs text-amber-900">
              <strong>Note:</strong> EHR integration requires API credentials to be configured by your administrator.
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>
    </Dialog>
  );
}