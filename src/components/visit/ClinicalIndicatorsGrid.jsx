import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Footprints, Wind, Activity, AlertTriangle, Thermometer, Brain, Pill, Heart } from "lucide-react";

// Per-indicator badge/text/label/background palette (verbatim from OASISScrubber).
const COLOR_STYLES = {
  blue: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-600', label: 'text-blue-900', badge: 'bg-blue-500' },
  cyan: { bg: 'bg-navy-50 border-navy-200', text: 'text-navy-600', label: 'text-navy-900', badge: 'bg-navy-500' },
  red: { bg: 'bg-red-50 border-red-200', text: 'text-red-600', label: 'text-red-900', badge: 'bg-red-500' },
  orange: { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-600', label: 'text-orange-900', badge: 'bg-orange-500' },
  purple: { bg: 'bg-navy-50 border-navy-200', text: 'text-navy-600', label: 'text-navy-900', badge: 'bg-navy-500' },
  pink: { bg: 'bg-gold-50 border-gold-200', text: 'text-gold-600', label: 'text-gold-900', badge: 'bg-gold-500' },
  amber: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-600', label: 'text-amber-900', badge: 'bg-amber-500' },
  rose: { bg: 'bg-red-50 border-red-200', text: 'text-red-600', label: 'text-red-900', badge: 'bg-red-500' },
  teal: { bg: 'bg-navy-50 border-navy-200', text: 'text-navy-600', label: 'text-navy-900', badge: 'bg-navy-500' },
  indigo: { bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-600', label: 'text-indigo-900', badge: 'bg-indigo-500' },
  green: { bg: 'bg-green-50 border-green-200', text: 'text-green-600', label: 'text-green-900', badge: 'bg-green-500' },
};

const INDICATORS = [
  { key: 'assistDevices', label: 'Assistive Devices', icon: Footprints, color: 'blue' },
  { key: 'oxygenUse', label: 'Oxygen Use', icon: Wind, color: 'cyan' },
  { key: 'woundPresent', label: 'Wounds', icon: Activity, color: 'red' },
  { key: 'fallRisk', label: 'Fall Risk', icon: AlertTriangle, color: 'orange' },
  { key: 'painMentioned', label: 'Pain', icon: Thermometer, color: 'purple' },
  { key: 'cognitiveIssues', label: 'Cognitive', icon: Brain, color: 'pink' },
  { key: 'diabetic', label: 'Diabetic', icon: Pill, color: 'amber' },
  { key: 'cardiacIssues', label: 'Cardiac', icon: Heart, color: 'rose' },
];

/**
 * ClinicalIndicatorsGrid — the compact detected/not-found status grid for the
 * deterministic clinical indicators (`extractedIndicators.clinical`). Each tile
 * shows the indicator's icon, a Detected/Not found badge, and a tooltip with the
 * matching narrative phrases. Extracted verbatim from OASISScrubber's
 * extracted-indicators preview; purely presentational, no handlers.
 *
 * @param {{ clinical: Record<string, { detected?: boolean, sentences?: string[] }> }} props
 */
export default function ClinicalIndicatorsGrid({ clinical }) {
  if (!clinical) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {INDICATORS.map(({ key, label, icon: Icon, color }) => {
        const indicator = clinical[key];
        const cs = COLOR_STYLES[color] || COLOR_STYLES.blue;
        return (
          <TooltipProvider key={key}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`p-2 rounded border ${
                  indicator?.detected
                    ? cs.bg
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${indicator?.detected ? cs.text : 'text-slate-400'}`} />
                    <span className={`text-xs font-medium ${indicator?.detected ? cs.label : 'text-slate-500'}`}>
                      {label}
                    </span>
                  </div>
                  <div className="mt-1">
                    {indicator?.detected ? (
                      <Badge className={`${cs.badge} text-white text-xs`}>Detected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Not found</Badge>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                {indicator?.sentences?.length > 0 ? (
                  <div className="text-xs space-y-1">
                    <p className="font-semibold">Relevant phrases:</p>
                    {indicator.sentences.slice(0, 3).map((s, i) => (
                      <p key={i} className="text-slate-600">"{s.substring(0, 100)}..."</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs">No mentions found in narrative</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}
