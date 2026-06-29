import { TrendingUp } from "lucide-react";

/**
 * Quality measures & star-rating impact — a bulleted list of free-text impact
 * statements returned by the scrubber. Renders nothing when empty.
 */
export default function QualityMeasuresImpact({ measures }) {
  if (!measures || measures.length === 0) return null;

  return (
    <div className="bg-navy-50 p-4 rounded-lg border-2 border-navy-200">
      <h4 className="font-bold text-navy-900 mb-3 flex items-center gap-2">
        <TrendingUp className="w-5 h-5" />
        Quality Measures & Star Rating Impact
      </h4>
      <ul className="space-y-2">
        {measures.map((measure, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-navy-900">
            <span className="font-bold text-navy-600 mt-0.5">★</span>
            <span>{measure}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
