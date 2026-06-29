import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stethoscope } from "lucide-react";

/**
 * ClinicalGroupSummary — renders the PDGM clinical-group determination
 * (`extractedIndicators.clinicalGroup`: { group, name, confidence,
 * matchedPatterns[] }). Extracted from OASISScrubber, which rendered the same
 * data two ways:
 *
 *   - "compact"  — a small indigo preview in the extracted-indicators section.
 *   - "expanded" — a full card in the "Indicators" tab.
 *
 * Purely presentational; no handlers. Markup is a verbatim move from the parent.
 *
 * @param {{ clinicalGroup: { group: string, name: string, confidence: string, matchedPatterns: string[] }, variant?: 'compact'|'expanded' }} props
 */
export default function ClinicalGroupSummary({ clinicalGroup, variant = "expanded" }) {
  if (!clinicalGroup) return null;

  if (variant === "compact") {
    return (
      <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-indigo-900">PDGM Clinical Group</span>
          <Badge className={`${
            clinicalGroup.confidence === 'high' ? 'bg-green-600' :
            clinicalGroup.confidence === 'medium' ? 'bg-yellow-600' : 'bg-red-600'
          }`}>
            {clinicalGroup.confidence} confidence
          </Badge>
        </div>
        <p className="text-sm text-indigo-800 font-semibold">
          {clinicalGroup.group} - {clinicalGroup.name}
        </p>
        {clinicalGroup.matchedPatterns.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {clinicalGroup.matchedPatterns.map((p, i) => (
              <Badge key={i} variant="outline" className="text-xs bg-white">{p}</Badge>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="border-indigo-200">
      <CardHeader className="py-3 bg-indigo-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-indigo-600" />
          PDGM Clinical Group Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-lg font-bold text-indigo-900">
              {clinicalGroup.group}
            </p>
            <p className="text-sm text-indigo-700">{clinicalGroup.name}</p>
          </div>
          <Badge className={`${
            clinicalGroup.confidence === 'high' ? 'bg-green-600' :
            clinicalGroup.confidence === 'medium' ? 'bg-yellow-600' : 'bg-red-600'
          } text-white`}>
            {clinicalGroup.confidence?.toUpperCase()} CONFIDENCE
          </Badge>
        </div>
        {clinicalGroup.matchedPatterns.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-1">Matched Patterns:</p>
            <div className="flex flex-wrap gap-1">
              {clinicalGroup.matchedPatterns.map((p, i) => (
                <Badge key={i} variant="outline" className="text-xs">{p}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
