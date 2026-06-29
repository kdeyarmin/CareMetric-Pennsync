import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

/**
 * MismatchesResults — body for the OASIS Results-tab "OASIS vs Narrative
 * Mismatches" category. Presentational; extracted verbatim from OASISScrubber.
 *
 * @param {{ items: Array<Record<string, any>> }} props
 */
export default function MismatchesResults({ items }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-navy-500 bg-navy-50">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="font-bold text-navy-900">{item.oasis_item}</h5>
              <Badge className={`${item.audit_risk === 'high' ? 'bg-red-600' : item.audit_risk === 'medium' ? 'bg-orange-500' : 'bg-blue-500'}`}>
                {item.audit_risk} audit risk
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-red-100 p-2 rounded border border-red-200">
                <p className="text-xs text-red-700">Uploaded OASIS Score</p>
                <p className="font-semibold text-red-800">{item.uploaded_score}</p>
              </div>
              <div className="bg-green-100 p-2 rounded border border-green-200">
                <p className="text-xs text-green-700">Narrative Suggests</p>
                <p className="font-semibold text-green-800">{item.narrative_suggests}</p>
              </div>
            </div>
            <div className="bg-white p-2 rounded border text-sm">
              <p className="text-xs text-slate-500">Discrepancy:</p>
              <p className="text-slate-900">{item.discrepancy}</p>
            </div>
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900 text-sm">
                <strong>Recommendation:</strong> {item.recommendation}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
