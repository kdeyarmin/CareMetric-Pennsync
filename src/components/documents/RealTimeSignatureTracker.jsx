import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Clock,
  TrendingUp
} from "lucide-react";
import {
  getDocumentDisplayName,
  getNormalizedSignatureStatus,
  isSignatureOverdue,
} from "@/components/signature/signatureUtils";

export default function RealTimeSignatureTracker({ patientId }) {
  const { data: signatures = [] } = useQuery({
    queryKey: ['patient-signatures', patientId],
    queryFn: () => base44.entities.DocumentSignature.filter({ patient_id: patientId }),
    initialData: [],
    refetchInterval: 5000, // Real-time updates every 5 seconds
    enabled: !!patientId
  });

  const normalizedSignatures = useMemo(() => signatures.map((signature) => ({
    ...signature,
    normalizedName: getDocumentDisplayName(signature),
    normalizedStatus: getNormalizedSignatureStatus(signature),
    isOverdue: isSignatureOverdue(signature),
  })), [signatures]);

  const stats = {
    total: normalizedSignatures.length,
    signed: normalizedSignatures.filter((signature) => signature.normalizedStatus === 'signed').length,
    pending: normalizedSignatures.filter((signature) => signature.normalizedStatus !== 'signed').length,
    overdue: normalizedSignatures.filter((signature) => signature.isOverdue).length
  };

  const completionRate = stats.total > 0 ? (stats.signed / stats.total) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Signature Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-slate-700">Completion Rate</span>
            <span className="text-sm font-bold text-slate-900">{completionRate.toFixed(0)}%</span>
          </div>
          <Progress value={completionRate} className="h-2" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 bg-slate-50 rounded-lg">
            <p className="text-xl sm:text-2xl font-bold text-slate-900">{stats.total}</p>
            <p className="text-xs text-slate-600">Total</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.signed}</p>
            <p className="text-xs text-slate-600">Signed</p>
          </div>
          <div className="text-center p-3 bg-yellow-50 rounded-lg">
            <p className="text-xl sm:text-2xl font-bold text-yellow-600">{stats.pending}</p>
            <p className="text-xs text-slate-600">Pending</p>
          </div>
          <div className="text-center p-3 bg-red-50 rounded-lg">
            <p className="text-xl sm:text-2xl font-bold text-red-600">{stats.overdue}</p>
            <p className="text-xs text-slate-600">Overdue</p>
          </div>
        </div>

        {/* Recent Signatures */}
        {normalizedSignatures.length > 0 && (
          <div className="space-y-2 mt-4">
            <p className="text-sm font-medium text-slate-700">Recent Activity</p>
            {normalizedSignatures.slice(0, 3).map((sig) => (
              <div key={sig.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {sig.normalizedStatus === 'signed' ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-yellow-600 shrink-0" />
                  )}
                  <span className="text-sm truncate">{sig.normalizedName}</span>
                </div>
                <Badge
                  className={
                    sig.normalizedStatus === 'signed'
                      ? "bg-green-100 text-green-800"
                      : sig.isOverdue
                      ? "bg-red-100 text-red-800"
                      : "bg-yellow-100 text-yellow-800"
                  }
                >
                  {sig.normalizedStatus === 'signed' ? 'Signed' : sig.isOverdue ? 'Overdue' : 'Pending'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
