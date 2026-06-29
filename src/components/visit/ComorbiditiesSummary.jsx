import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2 } from "lucide-react";

/**
 * ComorbiditiesSummary — renders the PDGM comorbidity analysis
 * (`extractedIndicators.comorbidities`: { count, adjustment, high[], low[] }).
 * Extracted from OASISScrubber, which rendered the same data two ways:
 *
 *   - "compact"  — a small chip list shown in the extracted-indicators preview,
 *     hidden entirely when no comorbidities were found.
 *   - "expanded" — a full high/low-impact card in the "Indicators" tab, always
 *     shown (with "None identified" placeholders).
 *
 * Purely presentational; no handlers. Markup is a verbatim move from the parent.
 *
 * @param {{ comorbidities: { count: number, adjustment: string, high: Array, low: Array }, variant?: 'compact'|'expanded' }} props
 */
export default function ComorbiditiesSummary({ comorbidities, variant = "expanded" }) {
  if (variant === "compact") {
    if (!comorbidities?.count) return null;
    return (
      <div className="bg-green-50 p-3 rounded-lg border border-green-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-green-900">Identified Comorbidities</span>
          <Badge className={`${
            comorbidities.adjustment === 'high' ? 'bg-green-600' :
            comorbidities.adjustment === 'low' ? 'bg-yellow-600' : 'bg-slate-500'
          }`}>
            {comorbidities.adjustment} adjustment
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1">
          {comorbidities.high.map((c, i) => (
            <Badge key={`h-${i}`} className="bg-green-600 text-white text-xs">{c.name}</Badge>
          ))}
          {comorbidities.low.map((c, i) => (
            <Badge key={`l-${i}`} variant="outline" className="text-xs">{c.name}</Badge>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="border-green-200">
      <CardHeader className="py-3 bg-green-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-600" />
          Comorbidity Analysis
          <Badge className={`ml-auto ${
            comorbidities.adjustment === 'high' ? 'bg-green-600' :
            comorbidities.adjustment === 'low' ? 'bg-yellow-600' : 'bg-slate-500'
          }`}>
            {comorbidities.adjustment?.toUpperCase()} Adjustment
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 p-3 rounded border border-green-200">
            <p className="text-xs font-semibold text-green-800 mb-2">High-Impact (1 = HIGH adj)</p>
            {comorbidities.high.length > 0 ? (
              <ul className="space-y-1">
                {comorbidities.high.map((c, i) => (
                  <li key={i} className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                    <span className="text-green-900">{c.name}</span>
                    <span className="text-xs text-green-600">({c.icd10_codes?.join(', ')})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">None identified</p>
            )}
          </div>
          <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
            <p className="text-xs font-semibold text-yellow-800 mb-2">Low-Impact (2+ = LOW adj)</p>
            {comorbidities.low.length > 0 ? (
              <ul className="space-y-1">
                {comorbidities.low.map((c, i) => (
                  <li key={i} className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-yellow-600" />
                    <span className="text-yellow-900">{c.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">None identified</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
