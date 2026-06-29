import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import OASISFeedbackPanel from "../oasis/OASISFeedbackPanel";

/**
 * OverscoringResults — body for the OASIS Results-tab "Overscoring Risks"
 * category. Extracted verbatim from OASISScrubber; feedback handlers lifted to
 * props (`onAccept(item)`, `onReject`, `onModify`).
 *
 * @param {{ items: Array<Record<string, any>>, visit: any, patient: any, onAccept: (item: any) => void, onReject: (reason?: string) => void, onModify: (text: string) => void }} props
 */
export default function OverscoringResults({ items, visit, patient, onAccept, onReject, onModify }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-red-500 bg-red-50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h5 className="font-bold text-red-900">{item.oasis_item}</h5>
              <div className="flex gap-2">
                {item.score_difference && (
                  <Badge className="bg-slate-600">{item.score_difference}</Badge>
                )}
                <Badge className={`${item.audit_risk === 'high' ? 'bg-red-600' : 'bg-orange-500'}`}>
                  {item.audit_risk} audit risk
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-red-100 p-2 rounded border border-red-200">
                <p className="text-xs text-red-700">Claimed/Implied Score</p>
                <p className="font-semibold text-red-800">{item.claimed_score}</p>
              </div>
              <div className="bg-white p-2 rounded border">
                <p className="text-xs text-slate-500">Actually Supported</p>
                <p className="font-semibold text-slate-700">{item.supported_score}</p>
              </div>
            </div>
            {item.narrative_evidence && (
              <div className="bg-white p-2 rounded border text-sm">
                <p className="text-xs text-slate-500 font-medium">📝 Contradicting Evidence:</p>
                <p className="text-slate-900 italic">"{item.narrative_evidence}"</p>
              </div>
            )}
            {item.cms_scoring_definition && (
              <div className="bg-blue-50 p-2 rounded border border-blue-200 text-sm">
                <p className="text-xs text-blue-700 font-medium">📋 CMS Definition (Supported Score):</p>
                <p className="text-blue-900">{item.cms_scoring_definition}</p>
              </div>
            )}
            {item.audit_vulnerability && typeof item.audit_vulnerability === 'object' && (
              <div className="bg-red-100 p-3 rounded border border-red-300 text-sm space-y-2">
                <p className="text-xs text-red-700 font-bold">⚠️ AUDIT VULNERABILITY:</p>
                {item.audit_vulnerability.type && (
                  <Badge variant="outline" className="bg-red-200 text-red-800 border-red-400 text-xs">
                    {item.audit_vulnerability.type} Review Risk
                  </Badge>
                )}
                {item.audit_vulnerability.specific_risk && (
                  <p className="text-red-900"><strong>Risk:</strong> {item.audit_vulnerability.specific_risk}</p>
                )}
                {item.audit_vulnerability.potential_recoupment && (
                  <p className="text-red-800 font-semibold">💰 Potential Recoupment: {item.audit_vulnerability.potential_recoupment}</p>
                )}
                {item.audit_vulnerability.documentation_that_contradicts && (
                  <p className="text-red-900"><strong>Auditor Would Cite:</strong> "{item.audit_vulnerability.documentation_that_contradicts}"</p>
                )}
              </div>
            )}
            <div className="bg-yellow-50 p-3 rounded border border-yellow-200 text-sm">
              <p className="text-xs text-yellow-700 font-medium mb-2">🔧 Recommended Action:</p>
              <p className="text-yellow-900 font-medium">{item.recommended_action || item.recommendation}</p>
            </div>
            {(item.if_keeping_score || item.if_lowering_score) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {item.if_keeping_score && (
                  <div className="bg-blue-50 p-2 rounded border border-blue-200">
                    <p className="text-xs text-blue-700 font-medium">If Keeping Score:</p>
                    <p className="text-blue-900 text-xs">{item.if_keeping_score}</p>
                  </div>
                )}
                {item.if_lowering_score && (
                  <div className="bg-green-50 p-2 rounded border border-green-200">
                    <p className="text-xs text-green-700 font-medium">If Lowering Score:</p>
                    <p className="text-green-900 text-xs">{item.if_lowering_score}</p>
                  </div>
                )}
              </div>
            )}
            <OASISFeedbackPanel
              suggestion={item}
              suggestionType="overscoring"
              oasisItem={item.oasis_item}
              visitId={visit?.id}
              patientId={patient?.id}
              onAccept={() => onAccept(item)}
              onReject={onReject}
              onModify={onModify}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
