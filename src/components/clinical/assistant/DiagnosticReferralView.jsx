import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, TestTube, Stethoscope, HeartPulse, Bell,
  ChevronDown, ChevronUp, ShieldCheck, Activity
} from "lucide-react";

const URGENCY_STYLE = {
  stat: "bg-red-100 text-red-700",
  emergent: "bg-red-100 text-red-700",
  within_24hrs: "bg-amber-100 text-amber-700",
  urgent: "bg-amber-100 text-amber-700",
  within_week: "bg-blue-100 text-blue-700",
  routine: "bg-slate-100 text-slate-600",
  next_visit: "bg-slate-100 text-slate-600",
  when_available: "bg-slate-50 text-slate-500",
};

const CAT_ICON = {
  lab: "🧪", imaging: "📷", screening: "📋", medication_monitoring: "💊", point_of_care: "🩺",
};

const THERAPY_ICON = {
  physical_therapy: "🏃", occupational_therapy: "🤲", speech_therapy: "🗣️", respiratory_therapy: "🫁",
};

export default function DiagnosticReferralView({ data, onRefresh }) {
  const [showAllTests, setShowAllTests] = useState(false);
  const [showAllReferrals, setShowAllReferrals] = useState(false);

  if (!data) return null;

  const tests = data.diagnostic_tests || [];
  const referrals = data.specialist_referrals || [];
  const therapies = data.therapy_recommendations || [];
  const physicianComms = data.physician_communications || [];
  const preventiveGaps = data.preventive_care_gaps || [];
  const displayedTests = showAllTests ? tests : tests.slice(0, 4);
  const displayedReferrals = showAllReferrals ? referrals : referrals.slice(0, 4);

  const statTests = tests.filter(t => t.urgency === "stat" || t.urgency === "within_24hrs");
  const urgentReferrals = referrals.filter(r => r.urgency === "emergent" || r.urgency === "urgent");

  return (
    <div className="space-y-3">
      {/* Urgency Summary */}
      <div className="p-2.5 rounded-lg bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200/40">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-semibold text-indigo-800">
            {tests.length} test(s) · {referrals.length} referral(s) · {therapies.length} therapy
          </p>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
        <p className="text-[10px] text-slate-700">{data.urgency_summary}</p>
        {(statTests.length > 0 || urgentReferrals.length > 0) && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {statTests.length > 0 && (
              <Badge className="text-[7px] bg-red-100 text-red-700 px-1 py-0">
                {statTests.length} urgent test(s)
              </Badge>
            )}
            {urgentReferrals.length > 0 && (
              <Badge className="text-[7px] bg-amber-100 text-amber-700 px-1 py-0">
                {urgentReferrals.length} urgent referral(s)
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Diagnostic Tests */}
      {tests.length > 0 && (
        <Section title="Diagnostic Tests" icon={<TestTube className="w-3 h-3 text-purple-500" />}>
          {displayedTests.map((test, i) => (
            <div key={i} className="p-1.5 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-1 flex-wrap mb-0.5">
                <span className="text-xs">{CAT_ICON[test.test_category] || "🔬"}</span>
                <Badge variant="outline" className="text-[7px] px-1 py-0">{test.test_category?.replace(/_/g, " ")}</Badge>
                <Badge className={`text-[7px] px-1 py-0 ${URGENCY_STYLE[test.urgency] || URGENCY_STYLE.routine}`}>
                  {test.urgency?.replace(/_/g, " ")}
                </Badge>
                {test.requires_physician_order && (
                  <Badge className="text-[7px] bg-amber-100 text-amber-700 px-1 py-0">Needs Order</Badge>
                )}
              </div>
              <p className="text-[10px] font-semibold text-slate-800">{test.test_name}</p>
              <p className="text-[9px] text-slate-600">{test.clinical_indication}</p>
              <p className="text-[8px] text-indigo-700 mt-0.5"><strong>Action:</strong> {test.nurse_action}</p>
              {test.evidence_basis && (
                <p className="text-[8px] text-slate-400 italic mt-0.5">Evidence: {test.evidence_basis}</p>
              )}
            </div>
          ))}
          {tests.length > 4 && (
            <ShowMoreButton count={tests.length} shown={showAllTests} toggle={() => setShowAllTests(!showAllTests)} />
          )}
        </Section>
      )}

      {/* Specialist Referrals */}
      {referrals.length > 0 && (
        <Section title="Specialist Referrals" icon={<Stethoscope className="w-3 h-3 text-blue-500" />}>
          {displayedReferrals.map((ref, i) => (
            <div key={i} className="p-1.5 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-1 flex-wrap mb-0.5">
                <Badge variant="outline" className="text-[7px] px-1 py-0">{ref.referral_type?.replace(/_/g, " ")}</Badge>
                <Badge className={`text-[7px] px-1 py-0 ${URGENCY_STYLE[ref.urgency] || URGENCY_STYLE.routine}`}>
                  {ref.urgency?.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="text-[10px] font-semibold text-slate-800">{ref.specialty}</p>
              <p className="text-[9px] text-slate-600">{ref.clinical_rationale}</p>
              {ref.key_findings_to_share && (
                <p className="text-[8px] text-indigo-700 mt-0.5"><strong>Share:</strong> {ref.key_findings_to_share}</p>
              )}
              {ref.expected_outcome && (
                <p className="text-[8px] text-slate-500 mt-0.5">Expected: {ref.expected_outcome}</p>
              )}
              {ref.evidence_basis && (
                <p className="text-[8px] text-slate-400 italic mt-0.5">Evidence: {ref.evidence_basis}</p>
              )}
            </div>
          ))}
          {referrals.length > 4 && (
            <ShowMoreButton count={referrals.length} shown={showAllReferrals} toggle={() => setShowAllReferrals(!showAllReferrals)} />
          )}
        </Section>
      )}

      {/* Therapy Recommendations */}
      {therapies.length > 0 && (
        <Section title="Therapy Recommendations" icon={<HeartPulse className="w-3 h-3 text-green-500" />}>
          {therapies.map((th, i) => (
            <div key={i} className="flex items-start gap-1.5 py-1 border-b border-slate-100 last:border-0">
              <span className="text-xs mt-0.5">{THERAPY_ICON[th.therapy_type] || "🩺"}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-[10px] font-medium text-slate-800">
                    {th.therapy_type?.replace(/_/g, " ")}
                  </p>
                  <Badge className={`text-[7px] px-1 py-0 ${URGENCY_STYLE[th.urgency] || URGENCY_STYLE.routine}`}>
                    {th.urgency}
                  </Badge>
                </div>
                <p className="text-[9px] text-slate-600">{th.indication}</p>
                <p className="text-[8px] text-slate-500">Goals: {th.goals}</p>
                {th.frequency_suggestion && (
                  <p className="text-[8px] text-slate-400">Frequency: {th.frequency_suggestion}</p>
                )}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Physician Communications */}
      {physicianComms.length > 0 && (
        <Section title="Physician Communications" icon={<Bell className="w-3 h-3 text-red-500" />}>
          {physicianComms.map((c, i) => (
            <div key={i} className="p-1.5 rounded border border-amber-200/50 bg-amber-50/30 mb-1 last:mb-0">
              <div className="flex items-center gap-1 mb-0.5">
                <Badge className={`text-[7px] px-1 py-0 ${URGENCY_STYLE[c.urgency] || URGENCY_STYLE.routine}`}>
                  {c.urgency?.replace(/_/g, " ")}
                </Badge>
                {c.requires_order && (
                  <Badge className="text-[7px] bg-amber-100 text-amber-700 px-1 py-0">Order Needed</Badge>
                )}
              </div>
              <p className="text-[10px] font-medium text-slate-800">{c.topic}</p>
              {c.suggested_message && (
                <p className="text-[9px] text-slate-600 italic mt-0.5">"{c.suggested_message}"</p>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Preventive Care Gaps */}
      {preventiveGaps.length > 0 && (
        <Section title="Preventive Care Gaps" icon={<ShieldCheck className="w-3 h-3 text-emerald-500" />}>
          {preventiveGaps.map((g, i) => (
            <div key={i} className="flex items-start gap-1.5 py-1 border-b border-slate-100 last:border-0">
              <Activity className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-800">{g.measure}</p>
                <p className="text-[9px] text-slate-500">
                  {g.last_done ? `Last: ${g.last_done}` : "No record"} · Due: {g.due || "Now"}
                </p>
                <p className="text-[8px] text-indigo-700">{g.action_needed}</p>
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="rounded-lg border border-slate-200/50 p-2">
      <p className="text-[10px] font-semibold text-slate-700 flex items-center gap-1 mb-1.5">{icon}{title}</p>
      {children}
    </div>
  );
}

function ShowMoreButton({ count, shown, toggle }) {
  return (
    <button className="text-[9px] text-indigo-600 hover:underline flex items-center gap-1 mx-auto mt-1" onClick={toggle}>
      {shown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      {shown ? "Show less" : `Show all ${count}`}
    </button>
  );
}