import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";

/**
 * CompliantItemsResults — body for the OASIS Results-tab "Compliant OASIS Items"
 * category (a two-column grid). Presentational; extracted verbatim from
 * OASISScrubber.
 *
 * @param {{ items: Array<Record<string, any>> }} props
 */
export default function CompliantItemsResults({ items }) {
  if (!items?.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item, index) => (
        <div key={index} className="bg-green-50 p-3 rounded border border-green-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-900">{item.oasis_item}</p>
              <Badge variant="outline" className="text-xs mt-1">{item.category}</Badge>
              {item.evidence && (
                <p className="text-xs text-green-700 mt-1 truncate" title={item.evidence}>
                  "{item.evidence}"
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
