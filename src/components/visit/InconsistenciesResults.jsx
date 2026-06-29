import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

/**
 * InconsistenciesResults — body for the OASIS Results-tab "Inconsistencies
 * Found" category. Presentational; extracted verbatim from OASISScrubber.
 *
 * @param {{ items: Array<Record<string, any>> }} props
 */
export default function InconsistenciesResults({ items }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-orange-500 bg-orange-50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h5 className="font-bold text-orange-900">{item.issue}</h5>
              <div className="flex gap-2">
                {item.inconsistency_type && (
                  <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                    {item.inconsistency_type?.replace(/_/g, ' ')}
                  </Badge>
                )}
                {item.audit_risk && (
                  <Badge className={`${item.audit_risk === 'high' ? 'bg-red-600' : item.audit_risk === 'medium' ? 'bg-orange-500' : 'bg-blue-500'}`}>
                    {item.audit_risk} risk
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {item.location_1 && (
                <div className="bg-red-100 p-2 rounded border border-red-200">
                  <p className="text-xs text-red-700 font-medium">Statement 1:</p>
                  <p className="text-red-900 italic text-xs">"{item.location_1}"</p>
                </div>
              )}
              {item.location_2 && (
                <div className="bg-red-100 p-2 rounded border border-red-200">
                  <p className="text-xs text-red-700 font-medium">Statement 2 (Conflicts):</p>
                  <p className="text-red-900 italic text-xs">"{item.location_2}"</p>
                </div>
              )}
            </div>

            {item.oasis_items_affected && item.oasis_items_affected.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-slate-600 mr-1">Affects:</span>
                {item.oasis_items_affected.map((mi, idx) => (
                  <Badge key={idx} variant="outline" className="bg-white text-orange-800 border-orange-300 text-xs">
                    {mi}
                  </Badge>
                ))}
              </div>
            )}

            {item.why_problematic && (
              <div className="bg-white p-2 rounded border text-sm">
                <p className="text-xs text-slate-600 font-medium">Why This Is Problematic:</p>
                <p className="text-slate-900">{item.why_problematic}</p>
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
