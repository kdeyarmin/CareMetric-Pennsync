import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { getImpactBadge } from "./oasisScrubberData";
import OASISFeedbackPanel from "../oasis/OASISFeedbackPanel";

/**
 * CriticalMissingResults — body for the OASIS Results-tab "Critical Missing
 * OASIS Items" category. Extracted verbatim from OASISScrubber; feedback
 * handlers lifted to props (`onAccept(item)`, `onReject`, `onModify`).
 *
 * @param {{ items: Array<Record<string, any>>, visit: any, patient: any, onAccept: (item: any) => void, onReject: (reason?: string) => void, onModify: (text: string) => void }} props
 */
export default function CriticalMissingResults({ items, visit, patient, onAccept, onReject, onModify }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-red-500 bg-red-50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h5 className="font-bold text-red-900">{item.oasis_item}</h5>
                  <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300 text-xs">
                    {item.category}
                  </Badge>
                  <Badge className={`${getImpactBadge(item.reimbursement_impact)} text-white text-xs`}>
                    {item.reimbursement_impact?.toUpperCase()} IMPACT
                  </Badge>
                </div>
                <p className="text-sm text-red-800 mb-2">
                  <strong>Why Critical:</strong> {item.why_critical}
                </p>
              </div>
            </div>

            <div className="bg-white p-3 rounded border border-red-200">
              <p className="text-xs font-semibold text-slate-700 mb-1">
                <Info className="w-3 h-3 inline mr-1" />
                Documentation Guidance:
              </p>
              <p className="text-sm text-slate-900">{item.documentation_guidance}</p>
            </div>

            <div className="bg-green-50 p-3 rounded border border-green-200">
              <p className="text-xs font-semibold text-green-900 mb-1">
                ✓ Example of Compliant Documentation:
              </p>
              <p className="text-sm text-green-900 italic">"{item.example}"</p>
            </div>

            <OASISFeedbackPanel
              suggestion={item}
              suggestionType="missing_item"
              oasisItem={item.oasis_item}
              visitId={visit?.id}
              patientId={patient?.id}
              onAccept={() => onAccept(item)}
              onReject={onReject}
              onModify={onModify}
              reimbursementImpact={item.estimated_revenue_impact}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
