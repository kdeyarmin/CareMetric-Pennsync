import { useState, useEffect } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  ExternalLink,
  Search,
  RefreshCw,
  Loader2,
  FileText,
  AlertTriangle,
  Info,
  Bookmark,
  BookmarkCheck,
  Lightbulb,
  Clock
} from "lucide-react";

// CMS OASIS-E 2024 Reference Data (embedded for reliability)
const CMS_OASIS_REFERENCE = {
  lastUpdated: "2024-01-01",
  version: "OASIS-E",
  quickGuideItems: [
    "GG0130", "GG0170", "M1830", "M1860", "M1021", "M1023", "M1311", "M1322", "M2001", "M2010"
  ],
  sections: {
    "GG": {
      title: "Section GG: Functional Abilities and Goals",
      items: {
        "GG0130": {
          name: "Self-Care",
          description: "Assess patient's ability to perform self-care activities",
          scoringScale: {
            "06": "Independent - Patient completes activity by self with no assistance",
            "05": "Setup or clean-up assistance - Helper SETS UP or CLEANS UP",
            "04": "Supervision or touching assistance - Helper provides VERBAL CUES or STEADYING",
            "03": "Partial/moderate assistance - Helper does LESS THAN HALF the effort",
            "02": "Substantial/maximal assistance - Helper does MORE THAN HALF the effort",
            "01": "Dependent - Helper does ALL of the effort"
          },
          subItems: ["A. Eating", "B. Oral hygiene", "C. Toileting hygiene", "E. Shower/bathe", "F. Upper body dressing", "G. Lower body dressing", "H. Footwear"],
          pdgmImpact: "Directly affects functional impairment level and case-mix weight",
          cmsGuidance: "Document the patient's usual performance, not best day or worst day. Consider safety and quality of performance.",
          interpretiveGuidelines: "If patient requires cueing for safety, code as supervision (04). Physical contact for steadying = touching assistance (04)."
        },
        "GG0170": {
          name: "Mobility",
          description: "Assess patient's mobility abilities",
          scoringScale: {
            "06": "Independent",
            "05": "Setup or clean-up assistance",
            "04": "Supervision or touching assistance",
            "03": "Partial/moderate assistance",
            "02": "Substantial/maximal assistance",
            "01": "Dependent"
          },
          subItems: ["B. Sit to lying", "C. Lying to sitting", "D. Sit to stand", "E. Chair/bed transfer", "F. Toilet transfer", "I-O. Walking items", "P. Picking up object", "R/RR. Wheeling"],
          pdgmImpact: "Critical for functional level determination",
          cmsGuidance: "Code what patient actually does, with or without assistive device. Do not code potential ability.",
          interpretiveGuidelines: "Walking items should reflect actual distance patient walks. If patient uses wheelchair primarily, still assess walking ability."
        }
      }
    },
    "M1800": {
      title: "M1800-M1860: Functional Status",
      items: {
        "M1800": {
          name: "Grooming",
          description: "Current ability to tend to personal hygiene needs (washing face/hands, hair care, shaving, teeth, nails)",
          scoringScale: { "0": "Independent", "1": "Setup only", "2": "Assistance required", "3": "Dependent" },
          pdgmImpact: "Contributes to functional impairment score",
          cmsGuidance: "Assess ALL grooming tasks, not just one. Code the level that represents overall grooming ability.",
          interpretiveGuidelines: "Setup includes getting supplies ready. If patient needs help with ANY grooming task, do not code as independent."
        },
        "M1810": {
          name: "Upper Body Dressing",
          description: "Current ability to dress upper body safely",
          scoringScale: { "0": "Independent", "1": "Setup only", "2": "Assistance required", "3": "Dependent" },
          pdgmImpact: "Contributes to functional impairment score",
          cmsGuidance: "Includes selecting clothes and putting on/taking off upper body garments including fasteners.",
          interpretiveGuidelines: "If patient can dress but takes excessive time or has safety concerns, consider coding as needing assistance."
        },
        "M1820": {
          name: "Lower Body Dressing",
          description: "Current ability to dress lower body safely",
          scoringScale: { "0": "Independent", "1": "Setup only", "2": "Assistance required", "3": "Dependent" },
          pdgmImpact: "Contributes to functional impairment score",
          cmsGuidance: "Includes underwear, pants, socks, shoes. Consider bending, balance, and fine motor skills.",
          interpretiveGuidelines: "Adaptive equipment use (sock aid, long shoehorn) still counts as independent if no human help needed."
        },
        "M1830": {
          name: "Bathing",
          description: "Current ability to wash entire body safely",
          scoringScale: { 
            "0": "Independent - able to bathe self independently", 
            "1": "With help setup only - able with setup of supplies/equipment", 
            "2": "Participates in bathing - able to bathe in bed/chair with assist", 
            "3": "In bed bath - able to participate in bed bath", 
            "4": "Unable to participate - total assist required", 
            "5": "Unable to bathe self - requires total bathing by another", 
            "6": "Dependent - requires total assist and unable to participate" 
          },
          pdgmImpact: "High-weight item for functional level - significant revenue impact",
          cmsGuidance: "Consider the entire bathing process: getting to tub/shower, washing, drying, getting out safely.",
          interpretiveGuidelines: "If patient can only wash upper body and needs help with lower body, code as participates (2) or higher impairment."
        },
        "M1840": {
          name: "Toilet Transfer",
          description: "Current ability to get to and from the toilet or bedside commode safely",
          scoringScale: { 
            "0": "Independent", 
            "1": "Partial assistance - with some help", 
            "2": "Substantial assistance - unable without considerable help", 
            "3": "Bedpan/commode - uses bedpan or bedside commode", 
            "4": "Unable - unable to get to toilet/commode" 
          },
          pdgmImpact: "Contributes to functional impairment score",
          cmsGuidance: "Assess transfer ON and OFF toilet, not toileting hygiene (that's GG0130C).",
          interpretiveGuidelines: "If grab bars or raised seat are used independently, still code as independent."
        },
        "M1850": {
          name: "Transferring",
          description: "Current ability to move safely between surfaces (bed, chair, wheelchair, standing)",
          scoringScale: { 
            "0": "Independent", 
            "1": "Minimal human assist - with standby/contact guard", 
            "2": "Moderate assist 1 person - able with one person physical assist", 
            "3": "Moderate assist 2+ persons - requires 2+ person assist", 
            "4": "Maximal assist - weight-bearing assist required", 
            "5": "Dependent - unable to participate" 
          },
          pdgmImpact: "Contributes to functional impairment score",
          cmsGuidance: "Consider transfers to/from: bed, chair, wheelchair, toilet, car. Code overall transfer ability.",
          interpretiveGuidelines: "Standby assist for safety = minimal assist (1). Contact guard = minimal assist (1)."
        },
        "M1860": {
          name: "Ambulation",
          description: "Current ability to walk safely, once in standing position",
          scoringScale: { 
            "0": "Independent - able to walk independently on all surfaces", 
            "1": "With device only - requires use of device (cane, walker)", 
            "2": "Minimal assist - requires minimal human assistance or supervision", 
            "3": "Moderate assist - requires moderate human assistance", 
            "4": "Maximal assist - requires maximal human assistance", 
            "5": "Chairfast - unable to ambulate, uses wheelchair", 
            "6": "Bedbound - unable to ambulate or be up in chair" 
          },
          pdgmImpact: "High-weight item for functional level - significant revenue impact",
          cmsGuidance: "Assess ability to walk on level surfaces. Include use of assistive devices.",
          interpretiveGuidelines: "If patient uses wheelchair for distances but can walk short distances, code walking ability, not wheelchair use."
        }
      }
    },
    "Clinical": {
      title: "Clinical Assessment Items",
      items: {
        "M1021": { 
          name: "Primary Diagnosis", 
          description: "Primary diagnosis requiring home health services - ICD-10-CM code", 
          pdgmImpact: "Determines clinical grouping category - CRITICAL for payment",
          cmsGuidance: "Must be the diagnosis most related to the current home health plan of care. Must be an active diagnosis.",
          interpretiveGuidelines: "Cannot use Z-codes as primary. Symptom codes allowed only if underlying condition unknown. Must match physician orders."
        },
        "M1023": { 
          name: "Other Diagnoses", 
          description: "All secondary diagnoses - up to 24 ICD-10-CM codes", 
          pdgmImpact: "Affects comorbidity adjustment - can significantly increase payment",
          cmsGuidance: "Include all diagnoses that affect care, treatment, or recovery. Active conditions only.",
          interpretiveGuidelines: "Document all comorbidities that require nursing assessment, monitoring, or intervention. Historical conditions without current impact should not be included."
        },
        "M1033": { 
          name: "Risk for Hospitalization", 
          description: "Risk factors for hospitalization assessment", 
          pdgmImpact: "Quality measure impact - affects star ratings",
          cmsGuidance: "Assess for: recent hospitalizations, multiple comorbidities, polypharmacy, fall history, cognitive impairment, caregiver issues.",
          interpretiveGuidelines: "High-risk patients should have care plans addressing each identified risk factor."
        }
      }
    },
    "Wounds": {
      title: "Integumentary Status",
      items: {
        "M1306": { 
          name: "Pressure Ulcer Present", 
          description: "Does patient have an unhealed pressure ulcer/injury at any stage?",
          scoringScale: { "0": "No", "1": "Yes" },
          cmsGuidance: "Include all pressure ulcers/injuries regardless of stage. Mucosal pressure injuries are included.",
          interpretiveGuidelines: "Healed pressure ulcers should not be counted. Deep tissue injuries (DTI) are counted as present."
        },
        "M1311": { 
          name: "Current Number of Pressure Ulcers", 
          description: "Count of unhealed pressure ulcers/injuries by stage",
          pdgmImpact: "Affects clinical grouping for wound care patients",
          cmsGuidance: "Count each ulcer separately. If multiple ulcers present, document each with measurements.",
          interpretiveGuidelines: "Stage 2-4 ulcers and unstageable ulcers are counted. Stage 1 and DTI documented separately."
        },
        "M1322": { 
          name: "Most Problematic Pressure Ulcer Stage", 
          description: "Stage of most problematic (non-healing, largest, most severe) pressure ulcer",
          pdgmImpact: "Higher stages may affect clinical grouping",
          cmsGuidance: "If multiple ulcers at same stage, report the one that is most problematic based on size, depth, or healing status.",
          interpretiveGuidelines: "Unstageable ulcers due to slough/eschar may be most problematic even if other staged ulcers present."
        },
        "M1330": { 
          name: "Stasis Ulcer Present", 
          description: "Does patient have a stasis (venous) ulcer?",
          scoringScale: { "0": "No", "1": "Yes" },
          cmsGuidance: "Stasis ulcers typically on lower extremities with signs of venous insufficiency.",
          interpretiveGuidelines: "Arterial ulcers are NOT stasis ulcers. Mixed etiology ulcers should be coded based on primary etiology."
        },
        "M1340": { 
          name: "Surgical Wound Present", 
          description: "Does patient have a surgical wound?",
          scoringScale: { "0": "No", "1": "Yes" },
          cmsGuidance: "Includes any wound resulting from surgery that requires skilled assessment or treatment.",
          interpretiveGuidelines: "Well-healed surgical scars are not surgical wounds. Dehisced surgical wounds are counted."
        }
      }
    },
    "Medications": {
      title: "Medication Management",
      items: {
        "M2001": { 
          name: "Drug Regimen Review", 
          description: "Was a complete drug regimen review conducted?",
          cmsGuidance: "Must review ALL medications including OTC, herbals, and supplements. Compare to physician orders.",
          interpretiveGuidelines: "Review should identify: duplications, interactions, high-risk drugs, adherence issues, side effects."
        },
        "M2003": { 
          name: "Medication Follow-up", 
          description: "Was physician contacted regarding drug regimen issues?",
          cmsGuidance: "Document any contacts made to physician regarding medication concerns identified in M2001.",
          interpretiveGuidelines: "Contact required if clinically significant issues identified. Document outcome of contact."
        },
        "M2010": { 
          name: "High-Risk Drugs", 
          description: "Is patient receiving high-risk drugs?",
          pdgmImpact: "Affects quality measures and may indicate complex medication management needs",
          cmsGuidance: "High-risk drugs include: anticoagulants, diabetic agents, opioids, antipsychotics in elderly.",
          interpretiveGuidelines: "Patients on high-risk drugs require enhanced monitoring and education."
        },
        "M2020": { 
          name: "Oral Medication Management", 
          description: "Patient's current ability to prepare and take all oral medications reliably and safely",
          scoringScale: { 
            "0": "Independent - able to take correct dose at correct time", 
            "1": "Setup - needs pills dispensed in advance or reminders", 
            "2": "Assist - requires assistance with taking medications", 
            "3": "Dependent - must be given all medications by another", 
            "NA": "No oral medications" 
          },
          pdgmImpact: "May affect clinical grouping for medication management",
          cmsGuidance: "Assess knowledge of medications, ability to self-administer, and adherence.",
          interpretiveGuidelines: "If patient takes meds but often forgets doses, code as needing setup (1) at minimum."
        },
        "M2030": { 
          name: "Injectable Medication Management", 
          description: "Patient's current ability to prepare and take all injectable medications reliably and safely",
          scoringScale: { 
            "0": "Independent", 
            "1": "Setup - needs syringes prefilled", 
            "2": "Assist - requires assist with injections", 
            "3": "Dependent - unable to take injectable medications", 
            "NA": "No injectable medications" 
          },
          cmsGuidance: "Consider: drawing up medication, selecting injection site, administering injection, disposing sharps.",
          interpretiveGuidelines: "Insulin pen use may allow higher independence than vial/syringe method."
        }
      }
    }
  },
  pdgmRules: {
    functionalLevels: {
      low: { range: "0-5 points", description: "Minimal functional impairment", multiplier: 0.85 },
      medium: { range: "6-13 points", description: "Moderate functional impairment", multiplier: 1.0 },
      high: { range: "14+ points", description: "Significant functional impairment", multiplier: 1.25 }
    },
    clinicalGroups: [
      "MMTA - Surgical Aftercare",
      "MMTA - Cardiac/Circulatory",
      "MMTA - Complex Nursing",
      "MMTA - Wounds",
      "MMTA - Endocrine",
      "MMTA - GI/GU",
      "MMTA - Infectious Disease",
      "MMTA - Neuro/Rehab",
      "MMTA - Respiratory",
      "MMTA - Behavioral Health",
      "MMTA - Medication Management",
      "MMTA - Other"
    ],
    comorbidityAdjustments: {
      none: { criteria: "0 comorbidities", multiplier: 1.0 },
      low: { criteria: "1+ secondary diagnoses", multiplier: 1.03 },
      high: { criteria: "2+ high-value comorbidities", multiplier: 1.08 }
    }
  },
  resources: [
    { name: "CMS OASIS-E Guidance Manual", url: "https://www.cms.gov/medicare/quality/home-health/oasis-guidance-manual", description: "Official CMS guidance for OASIS-E data collection" },
    { name: "OASIS-E Data Collection Specifications", url: "https://www.cms.gov/medicare/quality/home-health/oasis-data-sets", description: "Technical specifications and data dictionaries" },
    { name: "PDGM Technical Report", url: "https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health", description: "Patient-Driven Groupings Model payment methodology" },
    { name: "Home Health CoP Regulations", url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-484", description: "Conditions of Participation - 42 CFR Part 484" },
    { name: "State Operations Manual - Appendix B", url: "https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/som107ap_b_hha.pdf", description: "Survey procedures and interpretive guidelines for HHAs" },
    { name: "MLN OASIS Resources", url: "https://www.cms.gov/medicare/quality/home-health", description: "Medicare Learning Network educational materials" }
  ],
  recentChanges: [
    { date: "2024-01-01", item: "OASIS-E", change: "Full implementation of OASIS-E version with GG items", impact: "high" },
    { date: "2024-01-01", item: "GG0130/GG0170", change: "GG functional items now primary drivers of functional score", impact: "high" },
    { date: "2024-01-01", item: "M1800-M1860", change: "Legacy functional items retained but GG takes precedence for PDGM", impact: "medium" }
  ]
};

export default function CMSComplianceReference({ oasisItem, onInsertGuidance, compact = false }) {
  const [searchTerm, setSearchTerm] = useState('');
  const ai = useAICall();
  const [liveUpdates, setLiveUpdates] = useState(null);
  const [selectedItem, setSelectedItem] = useState(oasisItem || null);
  const [activeTab, setActiveTab] = useState("all");
  const [bookmarkedItems, setBookmarkedItems] = useState(() => {
    try {
      const saved = localStorage.getItem("cms-oasis-bookmarks");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("cms-oasis-bookmarks", JSON.stringify(bookmarkedItems));
    } catch (e) {
      console.error("Failed to save bookmarks:", e);
    }
  }, [bookmarkedItems]);

  const fetchLiveUpdates = async () => {
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Check for any recent CMS OASIS-E updates or guidance changes effective 2024-2025. Focus on:
1. Any changes to functional scoring (GG items, M1800-M1860)
2. PDGM calculation updates
3. New documentation requirements
4. Quality measure changes

Return JSON:
{
  "hasUpdates": true|false,
  "lastChecked": "date",
  "updates": [
    {"effective_date": "date", "item": "M-item or section", "change": "description", "impact": "high|medium|low"}
  ],
  "alerts": ["any critical compliance alerts"],
  "newGuidance": ["any new documentation tips"]
}`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            hasUpdates: { type: "boolean" },
            lastChecked: { type: "string" },
            updates: { type: "array", items: { type: "object" } },
            alerts: { type: "array", items: { type: "string" } },
            newGuidance: { type: "array", items: { type: "string" } }
          }
        }
      });
      setLiveUpdates(result);
    } catch (error) {
      console.error("Error fetching updates:", error);
    }
  };

  const toggleBookmark = (itemKey) => {
    setBookmarkedItems(prev => {
      const newBookmarks = { ...prev };
      if (newBookmarks[itemKey]) {
        delete newBookmarks[itemKey];
      } else {
        newBookmarks[itemKey] = { savedAt: new Date().toISOString() };
      }
      return newBookmarks;
    });
  };

  const findItemByKey = (itemKey) => {
    for (const section of Object.values(CMS_OASIS_REFERENCE.sections)) {
      if (section.items?.[itemKey]) {
        return section.items[itemKey];
      }
    }
    return null;
  };

  const filteredItems = () => {
    if (!searchTerm) return CMS_OASIS_REFERENCE.sections;
    
    const lowerSearch = searchTerm.toLowerCase();
    const results = {};
    
    Object.entries(CMS_OASIS_REFERENCE.sections).forEach(([sectionKey, section]) => {
      const matchingItems = {};
      Object.entries(section.items || {}).forEach(([itemKey, item]) => {
        const searchableContent = [
          itemKey,
          item.name,
          item.description,
          item.pdgmImpact,
          item.cmsGuidance,
          item.interpretiveGuidelines,
          ...Object.values(item.scoringScale || {}),
          ...(item.subItems || [])
        ].filter(Boolean).join(" ").toLowerCase();
        
        if (searchableContent.includes(lowerSearch)) {
          matchingItems[itemKey] = item;
        }
      });
      if (Object.keys(matchingItems).length > 0) {
        results[sectionKey] = { ...section, items: matchingItems };
      }
    });
    return results;
  };

  const renderOASISItem = (itemKey, item, showBookmark = true) => (
    <div
      key={itemKey}
      className={`p-3 rounded-lg border ${
        selectedItem === itemKey ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 hover:bg-slate-100'
      } cursor-pointer transition-colors`}
      onClick={() => setSelectedItem(itemKey)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h4 className="font-semibold text-slate-900">{itemKey}: {item.name}</h4>
          {item.description && (
            <p className="text-xs text-slate-600 mt-1">{item.description}</p>
          )}
        </div>
        <div className="flex gap-1 items-center ml-2">
          {showBookmark && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                toggleBookmark(itemKey);
              }}
              className="h-8 w-8 p-0"
            >
              {bookmarkedItems[itemKey] ? (
                <BookmarkCheck className="w-4 h-4 text-navy-600" />
              ) : (
                <Bookmark className="w-4 h-4 text-slate-400" />
              )}
            </Button>
          )}
          {onInsertGuidance && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onInsertGuidance(itemKey, item);
              }}
              className="text-xs h-8"
            >
              Insert
            </Button>
          )}
        </div>
      </div>
      
      {item.scoringScale && (
        <div className="mt-2">
          <p className="text-xs font-medium text-slate-700 mb-1">Scoring Scale:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs">
            {Object.entries(item.scoringScale).map(([score, desc]) => (
              <div key={score} className="bg-white p-1.5 rounded border">
                <span className="font-mono font-bold text-blue-600">{score}</span>: {desc}
              </div>
            ))}
          </div>
        </div>
      )}

      {item.subItems && (
        <div className="mt-2">
          <p className="text-xs font-medium text-slate-700 mb-1">Sub-items:</p>
          <div className="flex flex-wrap gap-1">
            {item.subItems.map((sub, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">{sub}</Badge>
            ))}
          </div>
        </div>
      )}

      {item.cmsGuidance && (
        <Alert className="mt-2 py-1.5 px-2 bg-blue-50 border-blue-200">
          <BookOpen className="w-3 h-3 text-blue-600" />
          <AlertDescription className="text-xs text-blue-800">
            <strong>CMS Guidance:</strong> {item.cmsGuidance}
          </AlertDescription>
        </Alert>
      )}

      {item.interpretiveGuidelines && (
        <Alert className="mt-2 py-1.5 px-2 bg-navy-50 border-navy-200">
          <FileText className="w-3 h-3 text-navy-600" />
          <AlertDescription className="text-xs text-navy-800">
            <strong>Interpretive Guidelines:</strong> {item.interpretiveGuidelines}
          </AlertDescription>
        </Alert>
      )}

      {item.pdgmImpact && (
        <Alert className="mt-2 py-1.5 px-2 bg-green-50 border-green-200">
          <Info className="w-3 h-3 text-green-600" />
          <AlertDescription className="text-xs text-green-800">
            <strong>PDGM Impact:</strong> {item.pdgmImpact}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            CMS Reference
          </h4>
          <Button size="sm" variant="ghost" onClick={fetchLiveUpdates} disabled={ai.loading}>
            {ai.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>
        {selectedItem && findItemByKey(selectedItem) && (
          <div className="text-xs text-blue-800">
            <p className="font-medium">{selectedItem}: {findItemByKey(selectedItem)?.name}</p>
            {findItemByKey(selectedItem)?.pdgmImpact && (
              <p className="text-blue-600 mt-1">
                <Info className="w-3 h-3 inline mr-1" />
                {findItemByKey(selectedItem)?.pdgmImpact}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            CMS OASIS-E Compliance Reference
          </span>
          <Badge variant="outline" className="text-xs">
            v{CMS_OASIS_REFERENCE.version} | Updated {CMS_OASIS_REFERENCE.lastUpdated}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search OASIS items, keywords (e.g., M1830, pressure ulcer, bathing)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Live Updates Check */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={fetchLiveUpdates}
            disabled={ai.loading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {ai.loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Check for CMS Updates
          </Button>
          {liveUpdates && (
            <Badge className={liveUpdates.hasUpdates ? "bg-orange-500" : "bg-green-500"}>
              {liveUpdates.hasUpdates ? "Updates Available" : "Up to Date"}
            </Badge>
          )}
        </div>

        {/* Tabs for different views */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all" className="text-xs gap-1">
              <FileText className="w-3 h-3" />
              All Items
            </TabsTrigger>
            <TabsTrigger value="quick" className="text-xs gap-1">
              <Lightbulb className="w-3 h-3" />
              Quick Guide
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="text-xs gap-1">
              <BookmarkCheck className="w-3 h-3" />
              Saved ({Object.keys(bookmarkedItems).length})
            </TabsTrigger>
            <TabsTrigger value="resources" className="text-xs gap-1">
              <ExternalLink className="w-3 h-3" />
              Resources
            </TabsTrigger>
          </TabsList>

          {/* All Items Tab */}
          <TabsContent value="all" className="mt-4">
            {/* Live Updates Display */}
            {liveUpdates && (liveUpdates.updates?.length > 0 || liveUpdates.alerts?.length > 0) && (
              <Alert className="bg-orange-50 border-orange-200 mb-4">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <AlertDescription>
                  <p className="font-semibold text-orange-900 mb-2">Recent CMS Updates:</p>
                  {liveUpdates.updates?.map((update, idx) => (
                    <div key={idx} className="text-sm text-orange-800 mb-1">
                      <Badge className={`mr-2 text-xs ${update.impact === 'high' ? 'bg-red-500' : update.impact === 'medium' ? 'bg-orange-500' : 'bg-blue-500'}`}>
                        {update.impact}
                      </Badge>
                      <strong>{update.item}:</strong> {update.change}
                    </div>
                  ))}
                  {liveUpdates.alerts?.map((alert, idx) => (
                    <div key={idx} className="text-sm text-red-800 mt-1">⚠️ {alert}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            <ScrollArea className="h-[400px]">
              <Accordion type="multiple" className="space-y-2">
                {Object.entries(filteredItems()).map(([sectionKey, section]) => (
                  <AccordionItem key={sectionKey} value={sectionKey} className="border rounded-lg">
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <span className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                        {section.title}
                        <Badge variant="outline" className="text-xs">
                          {Object.keys(section.items || {}).length} items
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-3">
                        {Object.entries(section.items || {}).map(([itemKey, item]) => 
                          renderOASISItem(itemKey, item)
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </ScrollArea>
          </TabsContent>

          {/* Quick Guide Tab */}
          <TabsContent value="quick" className="mt-4">
            <Alert className="bg-yellow-50 border-yellow-200 mb-4">
              <Lightbulb className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800 text-sm">
                <strong>Quick Guide:</strong> Most commonly referenced OASIS items and those with highest PDGM revenue impact.
              </AlertDescription>
            </Alert>

            {/* Recent Changes */}
            {CMS_OASIS_REFERENCE.recentChanges?.length > 0 && (
              <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                <h4 className="text-sm font-semibold text-orange-900 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Recent Regulatory Changes
                </h4>
                <div className="space-y-2">
                  {CMS_OASIS_REFERENCE.recentChanges.map((change, idx) => (
                    <div key={idx} className="text-xs text-orange-800 flex items-start gap-2">
                      <Badge className={`text-xs flex-shrink-0 ${change.impact === 'high' ? 'bg-red-500' : 'bg-orange-500'}`}>
                        {change.impact}
                      </Badge>
                      <span><strong>{change.item}:</strong> {change.change} ({change.date})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ScrollArea className="h-[350px]">
              <div className="space-y-3">
                {CMS_OASIS_REFERENCE.quickGuideItems.map(itemKey => {
                  const item = findItemByKey(itemKey);
                  if (!item) return null;
                  return renderOASISItem(itemKey, item);
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Bookmarks Tab */}
          <TabsContent value="bookmarks" className="mt-4">
            {Object.keys(bookmarkedItems).length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Bookmark className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">No bookmarked items yet.</p>
                <p className="text-xs mt-1">Click the bookmark icon on any item to save it for quick access.</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {Object.keys(bookmarkedItems).map(itemKey => {
                    const item = findItemByKey(itemKey);
                    if (!item) return null;
                    return renderOASISItem(itemKey, item);
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* Resources Tab */}
          <TabsContent value="resources" className="mt-4">
            {/* PDGM Rules Reference */}
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200 mb-4">
              <h4 className="font-semibold text-indigo-900 mb-2">PDGM Functional Level Thresholds</h4>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {Object.entries(CMS_OASIS_REFERENCE.pdgmRules.functionalLevels).map(([level, data]) => (
                  <div key={level} className={`p-2 rounded border ${
                    level === 'high' ? 'bg-green-100 border-green-300' :
                    level === 'medium' ? 'bg-yellow-100 border-yellow-300' :
                    'bg-red-100 border-red-300'
                  }`}>
                    <p className="font-bold capitalize">{level}</p>
                    <p className="text-slate-700">{data.range}</p>
                    <p className="text-slate-600">×{data.multiplier}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Clinical Groups */}
            <div className="bg-navy-50 p-4 rounded-lg border border-navy-200 mb-4">
              <h4 className="font-semibold text-navy-900 mb-2">PDGM Clinical Groups</h4>
              <div className="flex flex-wrap gap-1">
                {CMS_OASIS_REFERENCE.pdgmRules.clinicalGroups.map((group, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs bg-white">{group}</Badge>
                ))}
              </div>
            </div>

            {/* External Resources */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Official CMS Resources
              </h4>
              <div className="grid gap-2">
                {CMS_OASIS_REFERENCE.resources.map((resource, idx) => (
                  <a
                    key={idx}
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border hover:bg-blue-50 hover:border-blue-200 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-600">{resource.name}</p>
                      {resource.description && (
                        <p className="text-xs text-slate-600 mt-0.5">{resource.description}</p>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}