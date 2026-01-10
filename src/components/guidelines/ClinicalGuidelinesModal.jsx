import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader, Search, X, Sparkles, BookOpen, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const guidelineCategories = [
  "Home Health",
  "Hospice",
  "Skilled Nursing",
  "Rehabilitation",
  "Long-Term Care"
];

const commonConditions = [
  "CHF",
  "COPD",
  "Diabetes",
  "Wound Care",
  "Post-Operative",
  "Stroke/CVA",
  "Dementia",
  "Hypertension",
  "Pain Management",
  "Medication Management"
];

// Sample guidelines database (in production, these would come from a backend)
const sampleGuidelines = [
  {
    id: 1,
    title: "Medicare Home Health Documentation Standards",
    specialty: "Home Health",
    condition: "General",
    summary: "Comprehensive guidelines for Medicare-compliant home health documentation including homebound status, skilled need justification, and patient response.",
    content: "Document should include: 1) Homebound status with specific limitations 2) Skilled nursing need with clinical justification 3) Patient response to interventions 4) Progress toward goals 5) Plan of care",
    source: "CMS",
    lastUpdated: "2025-12-15"
  },
  {
    id: 2,
    title: "CHF Documentation Best Practices",
    specialty: "Home Health",
    condition: "CHF",
    summary: "Specific documentation requirements for patients with congestive heart failure including vital sign monitoring and clinical assessment.",
    content: "Key elements: Daily weight, edema assessment (0-4+), JVD assessment, lung sounds for crackles, S3 gallop, fluid status, medication compliance, dietary adherence",
    source: "American Heart Association",
    lastUpdated: "2025-11-20"
  },
  {
    id: 3,
    title: "COPD Assessment and Documentation",
    specialty: "Home Health",
    condition: "COPD",
    summary: "Guidelines for documenting COPD assessments and interventions in home health settings.",
    content: "Document: O2 sat on room air vs supplemental, respiratory rate, work of breathing, accessory muscle use, lung sounds (wheezes/rhonchi), oxygen therapy education",
    source: "GOLD Guidelines",
    lastUpdated: "2025-10-05"
  },
  {
    id: 4,
    title: "Wound Care Documentation Standards",
    specialty: "Home Health",
    condition: "Wound Care",
    summary: "Standardized wound assessment and documentation requirements.",
    content: "Measure: Length x Width x Depth (cm), wound bed (% granulation/slough/eschar), exudate (type/amount/odor), periwound condition, undermining/tunneling, surrounding skin integrity",
    source: "WOCN",
    lastUpdated: "2025-09-30"
  },
  {
    id: 5,
    title: "Hospice End-of-Life Documentation",
    specialty: "Hospice",
    condition: "General",
    summary: "Documentation requirements for hospice care including comfort measures, symptom management, and family support.",
    content: "Focus on: Comfort level, pain management effectiveness, symptom control, family coping, advance directives, goals of care discussions",
    source: "National Hospice and Palliative Care Organization",
    lastUpdated: "2025-11-01"
  }
];

export default function ClinicalGuidelinesModal({ 
  isOpen, 
  onClose, 
  roughNote = "", 
  diagnosis = "", 
  specialty = "",
  userEmail = ""
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState(specialty || "");
  const [selectedCondition, setSelectedCondition] = useState("");
  const [suggestedGuidelines, setSuggestedGuidelines] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [expandedGuideline, setExpandedGuideline] = useState(null);

  // Filter guidelines based on search and filters
  const filteredGuidelines = useMemo(() => {
    return sampleGuidelines.filter(guideline => {
      const matchesSearch = searchQuery === "" || 
        guideline.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        guideline.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        guideline.content.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesSpecialty = selectedSpecialty === "" || 
        guideline.specialty === selectedSpecialty;
      
      const matchesCondition = selectedCondition === "" || 
        guideline.condition === selectedCondition ||
        (selectedCondition === "General" && guideline.condition === "General");
      
      return matchesSearch && matchesSpecialty && matchesCondition;
    });
  }, [searchQuery, selectedSpecialty, selectedCondition]);

  // AI-powered suggestion of relevant guidelines
  useEffect(() => {
    if (isOpen && roughNote.length > 20 && diagnosis) {
      suggestRelevantGuidelines();
    }
  }, [isOpen, roughNote, diagnosis]);

  const suggestRelevantGuidelines = async () => {
    setIsLoadingSuggestions(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Based on this clinical note context, suggest the most relevant documentation guidelines.

VISIT CONTEXT:
- Diagnosis: ${diagnosis}
- Note Content: ${roughNote.substring(0, 500)}

Available Guidelines:
${sampleGuidelines.map(g => `- ${g.title} (${g.condition})`).join('\n')}

Suggest 2-3 most relevant guidelines by title. Consider the diagnosis, content of the note, and what documentation areas might need attention.

Return as JSON with array of suggested guideline titles.`,
        response_json_schema: {
          type: "object",
          properties: {
            suggested_guidelines: { 
              type: "array", 
              items: { type: "string" }
            },
            reasoning: { type: "string" }
          }
        }
      });

      const suggested = sampleGuidelines.filter(g => 
        result.suggested_guidelines.includes(g.title)
      );
      setSuggestedGuidelines(suggested);
    } catch (error) {
      // Error logged server-side
    }
    setIsLoadingSuggestions(false);
  };

  const copyGuidelineContent = (content) => {
    navigator.clipboard.writeText(content);
    toast.success('Guideline copied to clipboard');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-96 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            Clinical Documentation Guidelines
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search guidelines..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Select value={selectedSpecialty} onValueChange={setSelectedSpecialty}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Filter by specialty..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Specialties</SelectItem>
                  {guidelineCategories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedCondition} onValueChange={setSelectedCondition}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Filter by condition..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Conditions</SelectItem>
                  {commonConditions.map(cond => (
                    <SelectItem key={cond} value={cond}>{cond}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* AI Suggested Guidelines */}
          {suggestedGuidelines.length > 0 && (
            <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <p className="text-sm font-semibold text-purple-900">AI Suggested for Your Note</p>
              </div>
              <div className="space-y-2">
                {suggestedGuidelines.map(guideline => (
                  <button
                    key={guideline.id}
                    onClick={() => setExpandedGuideline(expandedGuideline === guideline.id ? null : guideline.id)}
                    className="w-full text-left p-2 bg-white rounded border border-purple-300 hover:border-purple-400 transition-colors"
                  >
                    <p className="text-sm font-medium text-purple-900">{guideline.title}</p>
                    <p className="text-xs text-purple-700">{guideline.summary}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Guidelines List */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredGuidelines.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No guidelines found matching your filters.</p>
            ) : (
              filteredGuidelines.map(guideline => (
                <Card key={guideline.id} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-3">
                    <div
                      onClick={() => setExpandedGuideline(expandedGuideline === guideline.id ? null : guideline.id)}
                      className="space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900">{guideline.title}</p>
                          <p className="text-xs text-gray-600 mt-1">{guideline.summary}</p>
                        </div>
                        <div className="text-gray-400 flex-shrink-0">
                          {expandedGuideline === guideline.id ? '−' : '+'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {guideline.specialty}
                        </Badge>
                        {guideline.condition !== 'General' && (
                          <Badge variant="secondary" className="text-xs">
                            {guideline.condition}
                          </Badge>
                        )}
                        <span className="text-xs text-gray-500">
                          {guideline.source}
                        </span>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {expandedGuideline === guideline.id && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 max-h-32 overflow-y-auto">
                          {guideline.content}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs flex-1"
                            onClick={() => copyGuidelineContent(guideline.content)}
                          >
                            Copy Guidelines
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}