import { listAuthorizedReferrals } from '@/functions/manageAuthorizedReferral';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  AlertCircle,
  Clock,
  ChevronRight,
  Bell
} from "lucide-react";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/dateLocal";

export default function PendingReferralsWidget() {
  const { tenantContext } = useAuth();
  const canUseReferralIntake = ['agency_admin', 'manager', 'office_staff']
    .includes(tenantContext?.tenant_role);
  const currentUserEmail = tenantContext?.user_email;

  // Filter to the current user's assigned referrals server-side so an assigned
  // (even urgent) referral can't fall outside the newest-10 page and vanish.
  const { data: referrals = [], isError: referralsUnavailable } = useQuery({
    queryKey: ['referrals', 'authorized', tenantContext?.agency_id, 'pending', currentUserEmail],
    queryFn: async () => {
      const results = await Promise.all(['new', 'awaiting_info'].map((status) => (
        listAuthorizedReferrals({
          agencyId: tenantContext.agency_id,
          assignedTo: currentUserEmail,
          status,
          limit: 10,
        })
      )));
      return results
        .flatMap((result) => result.referrals)
        .sort((left, right) => Date.parse(right.created_date) - Date.parse(left.created_date))
        .slice(0, 10);
    },
    initialData: [],
    enabled: canUseReferralIntake && !!currentUserEmail && !!tenantContext?.agency_id,
    refetchInterval: 60000, // Refresh every minute
  });

  const urgentReferrals = referrals.filter(r => r.priority === 'urgent' || r.priority === 'high');
  const awaitingInfo = referrals.filter(r => r.status === 'awaiting_info');

  if (!canUseReferralIntake) return null;

  if (referralsUnavailable) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Pending referrals could not be authorized. No empty queue is being inferred.
        </AlertDescription>
      </Alert>
    );
  }

  if (referrals.length === 0) return null;

  return (
    <Card className="border-2 border-orange-400 bg-orange-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="w-5 h-5 text-orange-600" />
          Pending Referrals
          <Badge className="bg-orange-600 ml-auto">{referrals.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {urgentReferrals.length > 0 && (
          <Alert className="bg-red-50 border-red-300">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 text-sm">
              <strong>{urgentReferrals.length} urgent referral{urgentReferrals.length > 1 ? 's' : ''}</strong> require immediate attention
            </AlertDescription>
          </Alert>
        )}

        {awaitingInfo.length > 0 && (
          <Alert className="bg-yellow-50 border-yellow-300">
            <Clock className="w-4 h-4 text-yellow-600" />
            <AlertDescription className="text-yellow-900 text-sm">
              <strong>{awaitingInfo.length} referral{awaitingInfo.length > 1 ? 's' : ''}</strong> awaiting additional information
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {referrals.slice(0, 5).map((referral) => (
            <div
              key={referral.id}
              className="bg-white p-3 rounded-lg border border-orange-200 hover:border-orange-400 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-slate-900 text-sm truncate">
                      {referral.patient_name || 'Unknown Patient'}
                    </p>
                    {referral.priority === 'urgent' || referral.priority === 'high' ? (
                      <Badge className="bg-red-600 text-xs">
                        {referral.priority}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-600">
                    {referral.referral_source || 'No source'} • {' '}
                    {/* referral_date is often date-only — parse as local calendar
                        day so west-of-UTC agencies don't see a day-shifted date.
                        Unparseable AI-extracted free text falls back to N/A. */}
                    {(() => {
                      const d = parseLocalDate(referral.referral_date);
                      return d ? format(d, 'MMM d') : 'N/A';
                    })()}
                  </p>
                  {referral.missing_information?.length > 0 && (
                    <p className="text-xs text-orange-700 mt-1">
                      Missing: {referral.missing_information.slice(0, 2).join(', ')}
                      {referral.missing_information.length > 2 && ` +${referral.missing_information.length - 2} more`}
                    </p>
                  )}
                </div>
                <Link to={createPageUrl(`ReferralIntake`)}>
                  <Button size="sm" variant="ghost" className="flex-shrink-0">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>

        <Link to={createPageUrl("ReferralIntake")} className="block">
          <Button variant="outline" className="w-full">
            <FileText className="w-4 h-4 mr-2" />
            View All Referrals
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
