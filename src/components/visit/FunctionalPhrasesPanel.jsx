import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footprints } from "lucide-react";

/**
 * FunctionalPhrasesPanel — ADL/IADL functional-phrase coverage extracted from
 * `extractedIndicators.functional` (a map of domain -> { allPhrases[],
 * assistLevel[] } built by buildFunctionalPhrases). Extracted from OASISScrubber,
 * which rendered the same data two ways:
 *
 *   - "compact"  — a 6-tile emoji count grid in the extracted-indicators preview.
 *   - "expanded" — an 8-domain card (with OASIS item codes, sample phrases, and
 *     detected assist levels) in the "Indicators" tab.
 *
 * Purely presentational; no handlers. Markup is a verbatim move from the parent.
 *
 * @param {{ functional: Record<string, { allPhrases?: string[], assistLevel?: string[] }>, variant?: 'compact'|'expanded' }} props
 */

// Compact preview — six core ADLs, emoji only.
const COMPACT_ADLS = [
  { key: 'bathing', label: 'Bathing', icon: '🚿' },
  { key: 'dressing', label: 'Dressing', icon: '👕' },
  { key: 'ambulation', label: 'Ambulation', icon: '🚶' },
  { key: 'transfer', label: 'Transfers', icon: '🔄' },
  { key: 'toileting', label: 'Toileting', icon: '🚽' },
  { key: 'grooming', label: 'Grooming', icon: '🪥' },
];

// Expanded detail — eight domains with the OASIS item codes they support.
const DETAIL_ADLS = {
  bathing: { label: 'Bathing (M1830)', icon: '🚿', items: ['M1830', 'GG0130E'] },
  dressing: { label: 'Dressing (M1810/20)', icon: '👕', items: ['M1810', 'M1820'] },
  ambulation: { label: 'Ambulation (M1860)', icon: '🚶', items: ['M1860', 'GG0170'] },
  transfer: { label: 'Transfers (M1850)', icon: '🔄', items: ['M1850'] },
  toileting: { label: 'Toileting (M1840)', icon: '🚽', items: ['M1840'] },
  grooming: { label: 'Grooming (M1800)', icon: '🪥', items: ['M1800'] },
  eating: { label: 'Eating (GG0130A)', icon: '🍽️', items: ['GG0130A'] },
  medications: { label: 'Medications (M2020)', icon: '💊', items: ['M2020', 'M2030'] },
};

export default function FunctionalPhrasesPanel({ functional, variant = "expanded" }) {
  if (!functional) return null;

  if (variant === "compact") {
    return (
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
        {COMPACT_ADLS.map(({ key, label, icon }) => {
          const phrases = functional[key];
          const count = phrases?.allPhrases?.length || 0;
          return (
            <div key={key} className={`p-2 rounded border text-center ${count > 0 ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
              <span className="text-lg">{icon}</span>
              <p className={`font-medium ${count > 0 ? 'text-blue-900' : 'text-slate-500'}`}>{label}</p>
              <p className={count > 0 ? 'text-blue-700' : 'text-slate-400'}>{count} phrases</p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 bg-blue-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Footprints className="w-4 h-4 text-blue-600" />
          ADL/IADL Functional Phrases
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(DETAIL_ADLS).map(([key, { label, icon, items }]) => {
            const phrases = functional[key];
            const count = phrases?.allPhrases?.length || 0;
            return (
              <div key={key} className={`p-3 rounded border ${count > 0 ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{icon}</span>
                    <span className="font-medium text-sm">{label}</span>
                  </div>
                  <Badge variant={count > 0 ? 'default' : 'outline'} className="text-xs">
                    {count} phrases
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {items.map(item => (
                    <Badge key={item} variant="outline" className="text-xs">{item}</Badge>
                  ))}
                </div>
                {count > 0 && phrases.allPhrases?.slice(0, 2).map((s, i) => (
                  <p key={i} className="text-xs text-slate-600 italic mb-1">"{s.substring(0, 80)}..."</p>
                ))}
                {phrases?.assistLevel?.length > 0 && (
                  <div className="mt-2 pt-2 border-t">
                    <p className="text-xs text-slate-500">Assist Levels Found:</p>
                    {phrases.assistLevel.slice(0, 2).map((a, i) => (
                      <Badge key={i} variant="outline" className="text-xs mr-1 mt-1">{a.substring(0, 40)}</Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
