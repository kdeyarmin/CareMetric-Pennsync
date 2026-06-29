import { Card, CardContent } from "@/components/ui/card";

/**
 * IncompleteAssessmentsResults — body for the OASIS Results-tab "Incomplete
 * Assessments" category. Presentational; extracted verbatim from OASISScrubber.
 *
 * @param {{ items: Array<Record<string, any>> }} props
 */
export default function IncompleteAssessmentsResults({ items }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-yellow-500 bg-yellow-50">
          <CardContent className="p-4 space-y-2">
            <h5 className="font-semibold text-yellow-900">{item.oasis_item}</h5>

            {item.current_documentation && (
              <div className="bg-white p-2 rounded border border-yellow-200">
                <p className="text-xs text-slate-600">Current documentation:</p>
                <p className="text-sm text-slate-900 italic">"{item.current_documentation}"</p>
              </div>
            )}

            <div className="bg-red-50 p-2 rounded border border-red-200">
              <p className="text-xs text-red-900">
                <strong>Issue:</strong> {item.issue}
              </p>
            </div>

            <div className="bg-blue-50 p-2 rounded border border-blue-200">
              <p className="text-xs text-blue-900">
                <strong>Guidance:</strong> {item.guidance}
              </p>
            </div>

            {item.example && (
              <div className="bg-green-50 p-2 rounded border border-green-200">
                <p className="text-xs text-green-900">
                  <strong>Better:</strong> "{item.example}"
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
