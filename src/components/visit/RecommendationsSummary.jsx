import { TrendingUp } from "lucide-react";

/**
 * OASIS documentation recommendations — a simple bulleted list of free-text
 * suggestions returned by the scrubber. Renders nothing when empty.
 */
export default function RecommendationsSummary({ recommendations }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
      <h4 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
        <TrendingUp className="w-5 h-5" />
        OASIS Documentation Recommendations
      </h4>
      <ul className="space-y-2">
        {recommendations.map((rec, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-blue-900">
            <span className="font-bold text-blue-600 mt-0.5">•</span>
            <span>{rec}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
