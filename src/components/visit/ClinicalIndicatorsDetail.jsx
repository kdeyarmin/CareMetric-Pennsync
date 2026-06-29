import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Footprints, Wind, Activity, AlertTriangle, Thermometer,
  Brain, Pill, Heart, Hand, CheckCircle2, Copy,
} from "lucide-react";

// Subset palette used by the detail card (verbatim from OASISScrubber).
const COLOR_STYLES = {
  blue: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-600' },
  cyan: { bg: 'bg-navy-50 border-navy-200', text: 'text-navy-600' },
  red: { bg: 'bg-red-50 border-red-200', text: 'text-red-600' },
  orange: { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-600' },
  purple: { bg: 'bg-navy-50 border-navy-200', text: 'text-navy-600' },
  pink: { bg: 'bg-gold-50 border-gold-200', text: 'text-gold-600' },
  amber: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-600' },
  rose: { bg: 'bg-red-50 border-red-200', text: 'text-red-600' },
  indigo: { bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-600' },
  green: { bg: 'bg-green-50 border-green-200', text: 'text-green-600' },
};

// Object literal preserves insertion order for Object.entries (matches original).
const INDICATORS = {
  assistDevices: { label: 'Assistive Devices', icon: Footprints, color: 'blue' },
  oxygenUse: { label: 'Oxygen Usage', icon: Wind, color: 'cyan' },
  woundPresent: { label: 'Wound Presence', icon: Activity, color: 'red' },
  fallRisk: { label: 'Fall Risk Factors', icon: AlertTriangle, color: 'orange' },
  painMentioned: { label: 'Pain Indicators', icon: Thermometer, color: 'purple' },
  cognitiveIssues: { label: 'Cognitive Concerns', icon: Brain, color: 'pink' },
  diabetic: { label: 'Diabetic Management', icon: Pill, color: 'amber' },
  cardiacIssues: { label: 'Cardiac Symptoms', icon: Heart, color: 'rose' },
  assistanceNeeded: { label: 'Assistance Levels', icon: Hand, color: 'indigo' },
  independentMentioned: { label: 'Independence', icon: CheckCircle2, color: 'green' },
};

/**
 * ClinicalIndicatorsDetail — the expanded clinical-indicators card shown in the
 * OASIS "Indicators" tab: per-indicator detail with up to three matched
 * narrative phrases, each copyable. Extracted verbatim from OASISScrubber;
 * the copy interaction is lifted to props (`copiedText` + `onCopy(text, id)`).
 *
 * @param {{ clinical: Record<string, { detected?: boolean, sentences?: string[] }>, copiedText: string|null, onCopy: (text: string, id: string) => void }} props
 */
export default function ClinicalIndicatorsDetail({ clinical, copiedText, onCopy }) {
  if (!clinical) return null;

  return (
    <Card>
      <CardHeader className="py-3 bg-slate-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="w-4 h-4 text-slate-600" />
          Clinical Indicators Extracted
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(INDICATORS).map(([key, { label, icon: Icon, color }]) => {
            const indicator = clinical[key];
            const cs = COLOR_STYLES[color] || COLOR_STYLES.blue;
            if (!indicator) return null;
            return (
              <div key={key} className={`p-3 rounded border ${indicator.detected ? cs.bg : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${indicator.detected ? cs.text : 'text-slate-400'}`} />
                    <span className="font-medium text-sm">{label}</span>
                  </div>
                  {indicator.detected ? (
                    <Badge className="bg-green-500 text-xs">Detected</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Not found</Badge>
                  )}
                </div>
                {indicator.detected && indicator.sentences?.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                    {indicator.sentences.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-start gap-1 group">
                        <p className="text-xs text-slate-600 italic flex-1">"{s.substring(0, 150)}{s.length > 150 ? '...' : ''}"</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                          onClick={() => onCopy(s, `${key}-${i}`)}
                        >
                          {copiedText === `${key}-${i}` ? (
                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
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
