import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import OASISFeedbackPanel from "../oasis/OASISFeedbackPanel";

/**
 * UnderscoringResults — body for the OASIS Results-tab "Underscoring
 * Opportunities" category. Extracted verbatim from OASISScrubber; the per-item
 * feedback handlers are lifted to props (`onAccept(item)`, `onReject`,
 * `onModify`). `visit`/`patient` supply the panel's visit/patient ids.
 *
 * @param {{ items: Array<Record<string, any>>, visit: any, patient: any, onAccept: (item: any) => void, onReject: (reason?: string) => void, onModify: (text: string) => void }} props
 */
export default function UnderscoringResults({ items, visit, patient, onAccept, onReject, onModify }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-green-500 bg-green-50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h5 className="font-bold text-green-900">{item.oasis_item}</h5>
              <div className="flex gap-2">
                {item.score_difference && (
                  <Badge className="bg-blue-600">{item.score_difference}</Badge>
                )}
                <Badge className="bg-green-600">{item.revenue_impact}</Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-white p-2 rounded border">
                <p className="text-xs text-slate-500">Current Implied Score</p>
                <p className="font-semibold text-slate-700">{item.current_implied_score || item.current_score}</p>
              </div>
              <div className="bg-green-100 p-2 rounded border border-green-300">
                <p className="text-xs text-green-700">Supported Score</p>
                <p className="font-semibold text-green-800">{item.supported_score}</p>
              </div>
            </div>
            {item.functional_level_change && (
              <Badge variant="outline" className="bg-navy-50 text-navy-800 border-navy-300">
                {item.functional_level_change}
              </Badge>
            )}
            <div className="bg-white p-2 rounded border text-sm">
              <p className="text-xs text-slate-500 font-medium">📝 Evidence from Narrative:</p>
              <p className="text-slate-900 italic">"{item.narrative_evidence}"</p>
            </div>
            {item.cms_scoring_definition && (
              <div className="bg-blue-50 p-2 rounded border border-blue-200 text-sm">
                <p className="text-xs text-blue-700 font-medium">📋 CMS Scoring Definition:</p>
                <p className="text-blue-900">{item.cms_scoring_definition}</p>
                {item.cms_reference && (
                  <p className="text-xs text-blue-600 mt-1">Ref: {item.cms_reference}</p>
                )}
              </div>
            )}
            {item.why_higher_score_applies && (
              <div className="bg-green-100 p-2 rounded border border-green-200 text-sm">
                <p className="text-xs text-green-700 font-medium">✓ Why Higher Score Applies:</p>
                <p className="text-green-900">{item.why_higher_score_applies}</p>
              </div>
            )}
            {item.documentation_enhancement && (
              <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-sm">
                <p className="text-xs text-yellow-700 font-medium">💡 Documentation Enhancement:</p>
                <p className="text-yellow-900">{item.documentation_enhancement}</p>
              </div>
            )}
            {item.example_compliant_language && (
              <div className="bg-emerald-50 p-3 rounded border border-emerald-200 text-sm">
                <p className="text-xs text-emerald-700 font-medium">✓ Example Compliant Language:</p>
                <p className="text-emerald-900 italic">"{item.example_compliant_language}"</p>
              </div>
            )}
            <OASISFeedbackPanel
              suggestion={item}
              suggestionType="underscoring"
              oasisItem={item.oasis_item}
              visitId={visit?.id}
              patientId={patient?.id}
              onAccept={() => onAccept(item)}
              onReject={onReject}
              onModify={onModify}
              reimbursementImpact={item.revenue_impact}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
