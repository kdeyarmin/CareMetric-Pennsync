import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

/**
 * VagueDocumentationResults — body for the OASIS Results-tab "Vague
 * Documentation" category. Extracted verbatim from OASISScrubber; the
 * "Insert Improved Language" action is lifted to the `onQuickFix(guidance,
 * example)` prop (the parent passes its handleQuickFix).
 *
 * @param {{ items: Array<Record<string, any>>, onQuickFix: (guidance: string, example: string) => void }} props
 */
export default function VagueDocumentationResults({ items, onQuickFix }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Card key={index} className="border-l-4 border-l-amber-500 bg-amber-50">
          <CardContent className="p-4 space-y-3">
            <h5 className="font-bold text-amber-900">{item.oasis_item}</h5>

            <div className="bg-red-100 p-2 rounded border border-red-200 text-sm">
              <p className="text-xs text-red-700 font-medium">❌ Current Vague Language:</p>
              <p className="text-red-900 italic">"{item.current_language}"</p>
            </div>

            <div className="bg-white p-2 rounded border text-sm">
              <p className="text-xs text-slate-600 font-medium">Problem:</p>
              <p className="text-slate-900">{item.problem}</p>
            </div>

            {item.cms_requirement && (
              <div className="bg-blue-50 p-2 rounded border border-blue-200 text-sm">
                <p className="text-xs text-blue-700 font-medium">📋 CMS Requirement:</p>
                <p className="text-blue-900">{item.cms_requirement}</p>
              </div>
            )}

            {item.defensibility_issue && (
              <div className="bg-orange-100 p-2 rounded border border-orange-200 text-sm">
                <p className="text-xs text-orange-700 font-medium">⚠️ Defensibility Issue:</p>
                <p className="text-orange-900">{item.defensibility_issue}</p>
              </div>
            )}

            {item.score_range_ambiguity && (
              <div className="bg-navy-50 p-2 rounded border border-navy-200 text-sm">
                <p className="text-xs text-navy-700 font-medium">🎯 Score Ambiguity:</p>
                <p className="text-navy-900">{item.score_range_ambiguity}</p>
              </div>
            )}

            {item.key_elements_to_add && item.key_elements_to_add.length > 0 && (
              <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-sm">
                <p className="text-xs text-yellow-700 font-medium">✚ Key Elements to Add:</p>
                <ul className="list-disc list-inside text-yellow-900 text-xs mt-1">
                  {item.key_elements_to_add.map((el, idx) => (
                    <li key={idx}>{el}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-green-100 p-3 rounded border border-green-200 text-sm">
              <p className="text-xs text-green-700 font-medium">✓ Improved Language:</p>
              <p className="text-green-900 italic">"{item.improved_language}"</p>
            </div>

            {(item.example_for_higher_score || item.example_for_lower_score) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {item.example_for_higher_score && (
                  <div className="bg-emerald-50 p-2 rounded border border-emerald-200">
                    <p className="text-xs text-emerald-700 font-medium">For Higher Score:</p>
                    <p className="text-emerald-900 text-xs italic">"{item.example_for_higher_score}"</p>
                  </div>
                )}
                {item.example_for_lower_score && (
                  <div className="bg-slate-50 p-2 rounded border border-slate-200">
                    <p className="text-xs text-slate-600 font-medium">For Lower Score:</p>
                    <p className="text-slate-800 text-xs italic">"{item.example_for_lower_score}"</p>
                  </div>
                )}
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              className="w-full border-green-300 text-green-700 hover:bg-green-50"
              onClick={() => onQuickFix(item.cms_requirement || item.problem, item.improved_language)}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Insert Improved Language
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
