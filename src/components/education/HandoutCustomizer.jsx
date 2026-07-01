import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { handoutTemplates } from "./handoutTemplates";

// Derived from the single source of truth (handoutTemplates) so EVERY topic has
// a customizer — the hand-copied list previously covered only 14 of 20 topics,
// leaving the rest with an empty customizer. `bullets` carries the REAL bullet
// strings (not just a count) so the nurse can see exactly which instructions —
// e.g. "Call 911 if…" — they are including or removing from the handout.
const templateSections = Object.fromEntries(
  Object.entries(handoutTemplates).map(([topic, t]) => [
    topic,
    (t.sections || []).map((sec) => ({
      heading: sec.heading,
      bullets: Array.isArray(sec.bullets) ? sec.bullets : [],
    })),
  ])
);

export default function HandoutCustomizer({ topicId, selectedSections, onSelectionChange }) {
  const [openSections, setOpenSections] = React.useState({});
  
  const sections = templateSections[topicId] || [];

  const toggleSection = (heading) => {
    setOpenSections(prev => ({ ...prev, [heading]: !prev[heading] }));
  };

  const handleSectionToggle = (heading, checked) => {
    const section = sections.find(s => s.heading === heading);
    const bullets = section?.bullets?.length ? Array(section.bullets.length).fill(checked) : undefined;

    onSelectionChange({
      ...selectedSections,
      [heading]: {
        included: checked,
        bullets: bullets
      }
    });
  };

  const handleBulletToggle = (heading, bulletIndex, checked) => {
    const currentSection = selectedSections[heading] || { included: true, bullets: [] };
    const newBullets = [...(currentSection.bullets || [])];
    newBullets[bulletIndex] = checked;
    
    onSelectionChange({
      ...selectedSections,
      [heading]: {
        included: currentSection.included,
        bullets: newBullets
      }
    });
  };

  const isSectionChecked = (heading) => {
    return selectedSections[heading]?.included !== false;
  };

  const isBulletChecked = (heading, bulletIndex) => {
    return selectedSections[heading]?.bullets?.[bulletIndex] !== false;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customize Content</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-96 overflow-y-auto">
        {sections.map((section, idx) => (
          <div key={idx} className="border rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id={`section-${idx}`}
                checked={isSectionChecked(section.heading)}
                onCheckedChange={(checked) => handleSectionToggle(section.heading, checked)}
              />
              <div className="flex-1">
                <Label
                  htmlFor={`section-${idx}`}
                  className="font-medium cursor-pointer"
                >
                  {section.heading}
                </Label>
                
                {section.bullets.length > 0 && (
                  <Collapsible open={openSections[section.heading]}>
                    <CollapsibleTrigger
                      onClick={() => toggleSection(section.heading)}
                      className="flex items-center gap-1 text-xs text-blue-600 mt-1 hover:text-blue-700"
                    >
                      {openSections[section.heading] ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                      {section.bullets.length} items
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2 pl-4 border-l-2 border-slate-200">
                      {section.bullets.map((bulletText, bulletIdx) => (
                        <div key={bulletIdx} className="flex items-start gap-2">
                          <Checkbox
                            id={`bullet-${idx}-${bulletIdx}`}
                            className="mt-0.5"
                            checked={isBulletChecked(section.heading, bulletIdx)}
                            onCheckedChange={(checked) => handleBulletToggle(section.heading, bulletIdx, checked)}
                            disabled={!isSectionChecked(section.heading)}
                          />
                          <Label
                            htmlFor={`bullet-${idx}-${bulletIdx}`}
                            title={bulletText}
                            className="text-xs text-slate-600 cursor-pointer leading-snug"
                          >
                            {bulletText}
                          </Label>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}