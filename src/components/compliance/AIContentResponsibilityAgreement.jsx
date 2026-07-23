import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, ShieldCheck, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BRAND_LOGO_URL } from "@/lib/brand";
import { logAudit } from "@/components/utils/auditLogger";
import {
  AI_CONTENT_AGREEMENT_TITLE,
  AI_CONTENT_AGREEMENT_INTRO,
  AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  AI_CONTENT_AGREEMENT_VERSION,
  buildAiContentAgreementAcceptance,
} from "@/lib/aiContentAgreement";

/**
 * AIContentResponsibilityAgreement
 *
 * Full-screen gate rendered (by App.jsx) after a user authenticates but before
 * any app route, whenever the user has not yet accepted the CURRENT version of
 * the AI-generated content responsibility agreement. Every user must sign off
 * that they are responsible for proofreading/editing AI-generated material and
 * for attesting to anything they submit — before they can use the software.
 *
 * On acceptance we persist the sign-off to the User record (so the gate stays
 * satisfied on future sessions), write an audit-trail entry (a durable
 * attestation record), then refresh the auth context so the app renders.
 */
export default function AIContentResponsibilityAgreement() {
  const { user, refreshUser, logout } = useAuth();
  const queryClient = useQueryClient();

  // One checkbox per acknowledgment; all must be checked to continue.
  const [checked, setChecked] = useState(() =>
    AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS.map(() => false),
  );
  const [saving, setSaving] = useState(false);

  const allChecked = useMemo(() => checked.every(Boolean), [checked]);

  const toggle = (index) =>
    setChecked((prev) => prev.map((v, i) => (i === index ? !v : v)));

  const accept = async () => {
    if (!allChecked || saving) return;
    setSaving(true);
    try {
      const acceptedAt = new Date().toISOString();
      await base44.auth.updateMe(buildAiContentAgreementAcceptance(acceptedAt));

      // Durable, timestamped attestation record for compliance/audit.
      await logAudit({
        action: "ai_content_agreement_accepted",
        entityType: "User",
        entityId: user?.id || null,
        details: {
          agreement_version: AI_CONTENT_AGREEMENT_VERSION,
          accepted_at: acceptedAt,
          acknowledgments: AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
        },
        severity: "info",
      });

      // Other surfaces read the user via a ["currentUser"] query; keep them in
      // step, then refresh the auth context so App.jsx re-evaluates the gate.
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      await refreshUser();
      toast.success("Thank you — your acknowledgment has been recorded.");
    } catch (err) {
      console.error("Failed to record AI content agreement:", err);
      toast.error("We couldn't record your acknowledgment. Please try again.");
      setSaving(false);
    }
    // On success we intentionally leave `saving` true: refreshUser() unmounts
    // this gate as the app renders, so there's no state to reset.
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-50 via-white to-navy-100 p-4">
      <div className="w-full max-w-2xl">
        {/* Brand lockup */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src={BRAND_LOGO_URL} alt="" className="h-9 w-9 rounded-lg" />
          <span className="flex flex-col leading-none">
            <span className="text-xl font-bold tracking-tight text-navy-900">
              Penn<span className="text-gold-600">Sync</span>
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
              by CareMetric
            </span>
          </span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-navy-600 via-navy-500 to-gold-400" />
          <div className="p-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-navy-50 to-navy-100 ring-1 ring-inset ring-navy-200/60">
                <Sparkles className="h-8 w-8 text-navy-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">{AI_CONTENT_AGREEMENT_TITLE}</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Please review and accept before using PennSync
              </p>
            </div>

            <p className="mb-5 text-sm leading-relaxed text-slate-600">
              {AI_CONTENT_AGREEMENT_INTRO}
            </p>

            <ScrollArea className="max-h-[40vh] rounded-xl border border-slate-200 bg-slate-50 p-1">
              <ul className="space-y-3 p-3">
                {AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS.map((text, index) => {
                  const id = `ai-ack-${index}`;
                  return (
                    <li key={id}>
                      <label
                        htmlFor={id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-navy-300"
                      >
                        <Checkbox
                          id={id}
                          checked={checked[index]}
                          onCheckedChange={() => toggle(index)}
                          className={`mt-0.5 ${checked[index] ? "border-navy-600 bg-navy-600 text-white" : ""}`}
                        />
                        <span className="text-sm leading-relaxed text-slate-700">{text}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-navy-100 bg-navy-50/60 p-3 text-xs text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-navy-600" />
              <span>
                By selecting <strong>I Agree &amp; Continue</strong>, you attest that you
                understand and accept these responsibilities. Your name, the date, and
                this agreement version are recorded for compliance.
              </span>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => { void logout(); }}
                className="text-slate-500 hover:text-slate-700"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </Button>
              <Button
                type="button"
                onClick={() => { void accept(); }}
                disabled={!allChecked || saving}
                className="bg-navy-600 hover:bg-navy-700 sm:min-w-[220px]"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recording…
                  </>
                ) : (
                  "I Agree & Continue"
                )}
              </Button>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Secure clinical platform · HIPAA compliant
        </p>
      </div>
    </div>
  );
}