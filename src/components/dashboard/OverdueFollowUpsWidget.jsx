import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { listAuthorizedReferrals } from '@/functions/manageAuthorizedReferral';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ClipboardCheck, ArrowRight, Inbox, Clock } from "lucide-react";

// A sent request with no provider response for this many days is "overdue"
// (matches the checkStaleFollowUpRequests escalation default).
export const OVERDUE_DAYS = 4;

// Roles that open every chart in their agency (the care-team rule in
// callerMayAccessPatient and D24). The referral broker also serves
// office_staff, who open no chart, so the widget is limited to these two:
// every follow-up it shows belongs to a chart the viewer may already open.
export const FOLLOW_UP_WIDGET_ROLES = Object.freeze(['agency_admin', 'manager']);

const daysSince = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 864e5) : null;
};

/** Pure: the follow-up rows that need office attention, most urgent first. */
export function followUpAttentionRows(referrals) {
  const out = [];
  for (const r of referrals || []) {
    const fu = r?.follow_up_requests;
    if (!fu || ["declined", "soc_completed"].includes(r.status)) continue;
    if (fu.status === "sent" && fu.generated_at) {
      const age = daysSince(fu.generated_at);
      out.push({
        referral: r,
        kind: "waiting",
        overdue: age !== null && age >= OVERDUE_DAYS,
        age,
        openCount: (fu.items || []).filter((it) => (it.item_status || "open") === "open").length,
      });
    } else if (fu.status === "received") {
      out.push({
        referral: r,
        kind: "response_in",
        overdue: false,
        age: fu.received_at ? daysSince(fu.received_at) : null,
        // Everything not yet resolved is pending review: portal answers arrive
        // as "answered", but a fax-back leaves items "open" while still being
        // resolvable from the document.
        openCount: (fu.items || []).filter((it) => it.item_status !== "resolved").length,
      });
    }
  }
  // Overdue sends (oldest first), then fresh responses, then the rest.
  return out.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      Number(b.kind === "response_in") - Number(a.kind === "response_in") ||
      (b.age ?? 0) - (a.age ?? 0)
  );
}

/**
 * Dashboard widget: provider follow-up requests needing office attention —
 * sent-but-unanswered (aging toward the SOC clock) and answered-but-unresolved.
 * Deep-links into the Referral Follow-Up worklist.
 *
 * Restored 2026-10-08 (owner decision). Referrals come only from the
 * agency-scoped manageAuthorizedReferral broker, bound to the viewer's exact
 * service-owned membership, and the widget shows itself only to an
 * agency_admin or manager of that agency, who may open every chart there. No
 * dollar figures regardless of role.
 */
export default function OverdueFollowUpsWidget() {
  const { tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id || null;
  const permitted = FOLLOW_UP_WIDGET_ROLES.includes(tenantContext?.tenant_role)
    && tenantContext?.membership_status === 'active'
    && !!agencyId;

  const { data: referrals, isError: referralsUnavailable } = useQuery({
    queryKey: ["referrals", "authorized", agencyId, "follow-up-attention", 200],
    queryFn: () => listAuthorizedReferrals({ agencyId, limit: 200 }).then((result) => result.referrals),
    enabled: permitted,
    refetchInterval: 5 * 60_000,
  });

  const rows = useMemo(() => followUpAttentionRows(referrals), [referrals]);

  if (!permitted) return null;

  if (referralsUnavailable) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          Referral follow-up status could not be authorized. No empty queue is being inferred.
        </AlertDescription>
      </Alert>
    );
  }

  if (rows.length === 0) return null;

  const overdueCount = rows.filter((x) => x.overdue).length;
  const responsesIn = rows.filter((x) => x.kind === "response_in").length;

  return (
    <Card className="border-2 border-amber-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-amber-600" aria-hidden="true" />
            Referral Follow-Ups Needing Attention
            {overdueCount > 0 && <Badge className="bg-red-600 text-white">{overdueCount} overdue</Badge>}
            {responsesIn > 0 && <Badge className="bg-blue-600 text-white">{responsesIn} response{responsesIn === 1 ? "" : "s"} in</Badge>}
          </CardTitle>
          <Link to="/ReferralFollowUp">
            <Button type="button" variant="outline" size="sm">
              Open worklist <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.slice(0, 6).map(({ referral, kind, overdue, age, openCount }) => (
          <Link
            key={referral.id}
            to={`/ReferralFollowUp?id=${encodeURIComponent(referral.id)}`}
            className="flex items-center justify-between gap-2 border rounded-lg p-2.5 hover:border-navy-400 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {referral.patient_name || "Unknown patient"}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {referral.extracted_data?.demographics?.referring_physician || referral.referral_source || "Unknown provider"}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {kind === "response_in" ? (
                <Badge className="bg-blue-100 text-blue-800 flex items-center gap-1">
                  <Inbox className="w-3 h-3" aria-hidden="true" /> review {openCount} item{openCount === 1 ? "" : "s"}
                </Badge>
              ) : (
                <Badge className={`flex items-center gap-1 ${overdue ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {age !== null ? `${age}d waiting` : "waiting"}
                </Badge>
              )}
            </div>
          </Link>
        ))}
        {rows.length > 6 && (
          <p className="text-xs text-slate-500 text-center">+{rows.length - 6} more on the worklist</p>
        )}
      </CardContent>
    </Card>
  );
}
