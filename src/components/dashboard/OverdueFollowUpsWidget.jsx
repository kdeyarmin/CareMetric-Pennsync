import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { base44 } from "@/api/base44Client";
import { isAdminView } from "@/lib/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, ArrowRight, Inbox, Clock } from "lucide-react";

// A sent request with no provider response for this many days is "overdue"
// (matches the checkStaleFollowUpRequests escalation default).
const OVERDUE_DAYS = 4;

const daysSince = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 864e5) : null;
};

/**
 * Dashboard widget: provider follow-up requests that need office attention —
 * sent-but-unanswered (aging toward the SOC clock) and answered-but-unresolved
 * (provider responded; items await staff review). Deep-links into the
 * Referral Follow-Up worklist.
 *
 * Self-gated to admin-level users: follow-up is back-office work and the
 * widget stays out of the nurses' clinical dashboard entirely. No dollar
 * figures here regardless of role.
 */
export default function OverdueFollowUpsWidget() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });
  const adminView = isAdminView(currentUser);

  const { data: referrals } = useQuery({
    queryKey: ["referrals", 200],
    queryFn: () => base44.entities.Referral.list("-created_date", 200),
    enabled: adminView,
  });

  const rows = useMemo(() => {
    const out = [];
    for (const r of referrals || []) {
      const fu = r.follow_up_requests;
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
          // Everything not yet resolved is pending review: portal answers
          // arrive as "answered", but a fax-back leaves items "open" while
          // still being resolvable from the document.
          openCount: (fu.items || []).filter((it) => it.item_status !== "resolved").length,
        });
      }
    }
    // Most urgent first: overdue sends (oldest first), then fresh responses,
    // then waiting-but-not-yet-overdue.
    return out.sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        Number(b.kind === "response_in") - Number(a.kind === "response_in") ||
        (b.age ?? 0) - (a.age ?? 0)
    );
  }, [referrals]);

  if (!adminView || rows.length === 0) return null;

  const overdueCount = rows.filter((x) => x.overdue).length;
  const responsesIn = rows.filter((x) => x.kind === "response_in").length;

  return (
    <Card className="border-2 border-amber-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-amber-600" />
            Referral Follow-Ups Needing Attention
            {overdueCount > 0 && <Badge className="bg-red-600 text-white">{overdueCount} overdue</Badge>}
            {responsesIn > 0 && <Badge className="bg-blue-600 text-white">{responsesIn} response{responsesIn === 1 ? "" : "s"} in</Badge>}
          </CardTitle>
          <Link to="/ReferralFollowUp">
            <Button type="button" variant="outline" size="sm">
              Open worklist <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.slice(0, 6).map(({ referral, kind, overdue, age, openCount }) => (
          <Link
            key={referral.id}
            to={`/ReferralFollowUp?id=${referral.id}`}
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
                  <Inbox className="w-3 h-3" /> review {openCount} item{openCount === 1 ? "" : "s"}
                </Badge>
              ) : (
                <Badge className={`flex items-center gap-1 ${overdue ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  <Clock className="w-3 h-3" />
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
