import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TelecomUnavailable, {
  SMS_CONSENT_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";
import { normalizeE164 } from "@/components/voice/phoneUtils";

/**
 * Patient contact presentation. Calls remain brokered by startMaskedCall.
 * Patient-specific texting stays disabled because SmsConsent and SmsMessage are
 * service-read-only and there is no tenant-authorized patient consent/history
 * broker yet. Never infer "no consent" from an unreadable ledger.
 */
export default function PatientContactActions({ patient, currentUser }) {
  const hasWorkNumber = !!currentUser?.work_phone_number;
  const hasPatientPhone = !!normalizeE164(patient?.phone);

  const startCall = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke("startMaskedCall", { patient_id: patient?.id });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => toast.success("Connecting… your phone will ring shortly, then we'll dial the patient."),
    onError: (err) => toast.error(err?.message || "Failed to start call"),
  });

  const disabledReason = !hasWorkNumber
    ? "You need a work number assigned. Ask an administrator to provision one."
    : !hasPatientPhone
      ? "This patient has no valid phone number on file."
      : !patient?.id
        ? "The patient record is still loading."
        : null;

  const callButton = (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={!!disabledReason || startCall.isPending}
      onClick={() => startCall.mutate()}
    >
      <PhoneCall className="mr-2 h-4 w-4" />
      {startCall.isPending ? "Connecting…" : "Call through work number"}
    </Button>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PhoneCall className="h-4 w-4 text-blue-600" />
          Contact Patient Privately
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">
          Calls go through your work number so your personal cell is never shared.
        </p>
        <TelecomUnavailable
          compact
          title="Patient texting unavailable"
          message={SMS_CONSENT_UNAVAILABLE_MESSAGE}
        />
        {disabledReason ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild><span className="block">{callButton}</span></TooltipTrigger>
              <TooltipContent>{disabledReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : callButton}
      </CardContent>
    </Card>
  );
}
