import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

/**
 * CrossValidationResults — body for the OASIS Results-tab "Cross-Validation
 * Issues" category. Presentational; extracted verbatim from OASISScrubber.
 *
 * @param {{ items: Array<Record<string, any>> }} props
 */
export default function CrossValidationResults({ items }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-orange-500 bg-orange-50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h5 className="font-bold text-orange-900">{item.rule_violated}</h5>
              <Badge className={`${item.audit_risk === 'high' ? 'bg-red-600' : item.audit_risk === 'medium' ? 'bg-orange-500' : 'bg-blue-500'}`}>
                {item.audit_risk} audit risk
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {item.items_involved?.map((mi, idx) => (
                <Badge key={idx} variant="outline" className="bg-white text-orange-800 border-orange-300 text-xs">
                  {mi}
                </Badge>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-red-100 p-2 rounded border border-red-200">
                <p className="text-xs text-red-700 font-medium">Current Values</p>
                <p className="text-red-900">{item.current_values}</p>
              </div>
              <div className="bg-green-100 p-2 rounded border border-green-200">
                <p className="text-xs text-green-700 font-medium">Expected Relationship</p>
                <p className="text-green-900">{item.expected_relationship}</p>
              </div>
            </div>
            {item.narrative_evidence && (
              <div className="bg-white p-2 rounded border text-sm">
                <p className="text-xs text-slate-500">Evidence:</p>
                <p className="text-slate-900 italic">"{item.narrative_evidence}"</p>
              </div>
            )}
            {item.pdgm_impact && (
              <div className="bg-navy-50 p-2 rounded border border-navy-200 text-sm">
                <p className="text-xs text-navy-700 font-medium">PDGM Impact:</p>
                <p className="text-navy-900">{item.pdgm_impact}</p>
              </div>
            )}
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900 text-sm">
                <strong>Resolution:</strong> {item.resolution}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
