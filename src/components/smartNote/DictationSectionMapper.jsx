import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronUp, ChevronDown, Activity, Target, ClipboardList, BookOpen, Shield } from "lucide-react";
import { toast } from 'sonner';

const SECTION_ICONS = {
  vitals: Activity,
  assessment: Target,
  plan: ClipboardList,
  education: BookOpen,
  safety: Shield,
};

const SECTION_COLORS = {
  vitals: "border-blue-200 bg-blue-50",
  assessment: "border-navy-200 bg-navy-50",
  plan: "border-green-200 bg-green-50",
  education: "border-amber-200 bg-amber-50",
  safety: "border-red-200 bg-red-50",
};

const SECTION_LABELS = {
  vitals: "Vital Signs",
  assessment: "Assessment",
  plan: "Plan",
  education: "Education / Teaching",
  safety: "Safety",
};

export default function DictationSectionMapper({ transcript, onSectionsMapped }) {
  const [mapping, setMapping] = useState(null);
  const ai = useAICall();
  const [expandedSection, setExpandedSection] = useState(null);
  const [editedSections, setEditedSections] = useState({});

  const mapSections = async () => {
    if (!transcript?.trim()) return;
    setMapping(null);
    
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Analyze this medical dictation and categorize it into distinct clinical sections.

DICTATION: "${transcript}"

For each section, extract ONLY the relevant sentences/phrases that belong there. Keep original wording.

Return JSON with these sections (include only if content exists):
{
  "vitals": "vital signs text (BP, HR, O2, temp, weight, etc.)",
  "assessment": "patient assessment and findings text",
  "plan": "plan and next steps text",
  "education": "patient/family education text",
  "safety": "safety, fall risk, medication adherence text",
  "unmapped": "any remaining clinical text that doesn't fit above categories"
}

Rules:
1. Extract ONLY text present in the dictation
2. Keep sentences intact and in order
3. Move exact phrases to their correct sections
4. Leave unmapped for content that doesn't fit standard categories`,
        response_json_schema: {
          type: "object",
          properties: {
            vitals: { type: "string" },
            assessment: { type: "string" },
            plan: { type: "string" },
            education: { type: "string" },
            safety: { type: "string" },
            unmapped: { type: "string" },
          },
        },
      });

      setMapping(result);
      setEditedSections({});
      
      if (onSectionsMapped) {
        onSectionsMapped(result);
      }
    } catch (err) {
      console.error("Section mapping error:", err);
      toast.error("Failed to map sections. Please try again.");
    }
  };

  const handleSectionEdit = (section, value) => {
    setEditedSections(prev => ({
      ...prev,
      [section]: value,
    }));
  };

  const getSectionContent = (section) => {
    return editedSections[section] !== undefined ? editedSections[section] : (mapping?.[section] || "");
  };

  const getSectionDisplay = (section) => {
    const content = getSectionContent(section);
    return content?.trim();
  };

  if (!transcript?.trim()) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 text-center text-sm text-slate-500">
        Transcription appears empty—record or paste dictation to auto-map sections.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!mapping ? (
        <Button
          onClick={mapSections}
          disabled={ai.loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 h-10 gap-2"
        >
          {ai.loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Mapping sections...
            </>
          ) : (
            <>
              🎯 Auto-Map into Sections
            </>
          )}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">Dictation mapped to sections:</p>
          
          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const Icon = SECTION_ICONS[key];
            const content = getSectionDisplay(key);
            const isExpanded = expandedSection === key;
            
            if (!content) return null;
            
            return (
              <div
                key={key}
                className={`rounded-lg border-2 ${SECTION_COLORS[key]} overflow-hidden`}
              >
                <button
                  onClick={() => setExpandedSection(isExpanded ? null : key)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/50 transition-colors"
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-semibold flex-1 text-left">{label}</span>
                  <span className="text-xs text-slate-500">
                    {content.split(" ").length} words
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                
                {isExpanded && (
                  <div className="border-t px-3 py-2">
                    <textarea
                      value={getSectionContent(key)}
                      onChange={(e) => handleSectionEdit(key, e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded p-2 font-mono focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 resize-none min-h-[80px]"
                      placeholder={`Enter ${label.toLowerCase()}...`}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {mapping?.unmapped?.trim() && (
            <div className="rounded-lg border-2 border-slate-200 bg-slate-50 overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === "unmapped" ? null : "unmapped")}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/50 transition-colors"
              >
                <span className="text-xs font-semibold flex-1 text-left">Additional Notes</span>
                {expandedSection === "unmapped" ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              
              {expandedSection === "unmapped" && (
                <div className="border-t px-3 py-2">
                  <textarea
                    value={editedSections.unmapped !== undefined ? editedSections.unmapped : mapping.unmapped}
                    onChange={(e) => handleSectionEdit("unmapped", e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded p-2 font-mono focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 resize-none min-h-[80px]"
                  />
                </div>
              )}
            </div>
          )}

          <Button
            onClick={() => {
              setMapping(null);
              setEditedSections({});
              setExpandedSection(null);
            }}
            variant="outline"
            size="sm"
            className="w-full text-xs h-8"
          >
            Remap Sections
          </Button>
        </div>
      )}
    </div>
  );
}