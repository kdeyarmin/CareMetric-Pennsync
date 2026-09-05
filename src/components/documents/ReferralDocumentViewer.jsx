import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, FileText, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/dateLocal";
import { openExternalUrl } from "@/components/utils/security";
import { ALL_ROWS, PATIENT_HISTORY_ROWS } from '@/lib/queryLimits';

export const REFERRAL_DOCUMENT_SEND_UNAVAILABLE_MESSAGE =
  'Sending referral documents through secure messages is unavailable until a tenant-authorized broker binds the selected Agency, patient, referral, thread, and recipient.';

export default function ReferralDocumentViewer({ patientId }) {
  const { data: referrals = [] } = useQuery({
    queryKey: ['patientReferrals', patientId],
    queryFn: () => base44.entities.Referral.filter({ patient_id: patientId }, '-created_date', PATIENT_HISTORY_ROWS),
    initialData: [],
    enabled: !!patientId,
  });

  // Filter to only show processed documents
  const processedReferrals = referrals.filter(r => r.processed_document_url || r.document_url);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers', ALL_ROWS, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list(undefined, ALL_ROWS);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    initialData: [],
    enabled: !!currentUser,
  });
  if (processedReferrals.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-slate-500">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p>No referral documents available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {processedReferrals.map((referral) => {
        // Prefer processed document, fall back to original
        const documentUrl = referral.processed_document_url || referral.document_url;
        const isProcessed = !!referral.processed_document_url;
        
        return (
        <Card key={referral.id} className="border-l-4 border-l-navy-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-navy-600" />
                  <p className="font-semibold text-slate-900">
                    {referral.patient_name || 'Unknown Patient'}
                  </p>
                  {isProcessed && (
                    <Badge className="bg-green-600">
                      AI Processed
                    </Badge>
                  )}
                  {referral.priority && (
                    <Badge className={
                      referral.priority === 'urgent' ? 'bg-red-600' :
                      referral.priority === 'high' ? 'bg-orange-600' :
                      'bg-blue-600'
                    }>
                      {referral.priority}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1 text-xs text-slate-600">
                  <p>Source: {referral.referral_source || 'N/A'}</p>
                  <p>Date: {referral.referral_date ? format(parseLocalDate(referral.referral_date), 'MMM d, yyyy') : 'N/A'}</p>
                  {referral.assigned_to && (
                    <p>Assigned to: {users.find(u => u.email === referral.assigned_to)?.full_name || referral.assigned_to}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {documentUrl && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openExternalUrl(documentUrl)}
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      {isProcessed ? 'View Processed' : 'View'}
                    </Button>
                    {referral.document_url && referral.processed_document_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openExternalUrl(referral.document_url)}
                      >
                        Original
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            {referral.diagnosis && (
              <div className="bg-navy-50 p-2 rounded">
                <p className="text-xs font-semibold text-navy-900">Primary Diagnosis</p>
                <p className="text-sm text-slate-900">{referral.diagnosis}</p>
              </div>
            )}
          </CardContent>
        </Card>
        );
      })}
      <Alert className="border-amber-300 bg-amber-50 text-amber-950">
        <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
        <AlertTitle>Secure document messaging unavailable</AlertTitle>
        <AlertDescription>{REFERRAL_DOCUMENT_SEND_UNAVAILABLE_MESSAGE}</AlertDescription>
      </Alert>
    </div>
  );
}
