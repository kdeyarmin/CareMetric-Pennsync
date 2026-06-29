import { FileCheck, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

/**
 * Documentation quality analysis — specificity / defensibility scores with
 * progress bars and an optional list of key weaknesses. Renders nothing when
 * there is no quality object.
 */
export default function DocumentationQualitySummary({ quality }) {
  if (!quality) return null;

  return (
    <div className="bg-slate-50 p-4 rounded-lg border-2 border-slate-200">
      <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
        <FileCheck className="w-5 h-5" />
        Documentation Quality Analysis
      </h4>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div className="text-center">
          <p className="text-xs text-slate-500">Specificity Score</p>
          <p className="text-2xl font-bold text-slate-900">{quality.specificity_score || 'N/A'}</p>
          <Progress value={quality.specificity_score || 0} className="h-2 mt-1" />
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500">Defensibility Score</p>
          <p className="text-2xl font-bold text-slate-900">{quality.defensibility_score || 'N/A'}</p>
          <Progress value={quality.defensibility_score || 0} className="h-2 mt-1" />
        </div>
      </div>
      {quality.key_weaknesses?.length > 0 && (
        <div className="bg-white p-3 rounded border">
          <p className="text-xs font-semibold text-slate-700 mb-2">Key Weaknesses:</p>
          <ul className="text-xs text-slate-600 space-y-1">
            {quality.key_weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-1">
                <XCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
