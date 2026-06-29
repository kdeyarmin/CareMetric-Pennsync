import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  FileText,
  Shield,
  MessageSquare,
  Sparkles,
  Loader2,
  CheckCircle2,
  Clock,
  Target
} from "lucide-react";

const trainingTopics = {
  documentation: {
    label: "Documentation Best Practices",
    icon: FileText,
    color: "blue",
    subtopics: [
      "Medicare-Compliant Note Writing",
      "Homebound Status Documentation",
      "Skilled Need Justification",
      "Vital Signs Recording",
      "Care Plan Updates",
      "Incident Reporting"
    ]
  },
  compliance: {
    label: "Regulatory Compliance",
    icon: Shield,
    color: "green",
    subtopics: [
      "Medicare Conditions of Participation",
      "OASIS Documentation Requirements",
      "HIPAA Privacy Guidelines",
      "State Regulations",
      "Billing Compliance",
      "Audit Preparation"
    ]
  },
  communication: {
    label: "Patient Communication",
    icon: MessageSquare,
    color: "purple",
    subtopics: [
      "Effective Patient Education",
      "Family Communication",
      "Difficult Conversations",
      "Cultural Sensitivity",
      "Teach-Back Method",
      "End-of-Life Discussions"
    ]
  }
};

export default function AITrainingContentGenerator({ onContentGenerated, _nurseEmail }) {
  const [selectedCategory, setSelectedCategory] = useState("documentation");
  const [selectedTopic, setSelectedTopic] = useState(null);
  const ai = useAICall();
  const [generatedContent, setGeneratedContent] = useState(null);

  const generateTrainingContent = async (topic) => {
    setSelectedTopic(topic);
    
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate comprehensive training content for home health nurses on: "${topic}"

Category: ${trainingTopics[selectedCategory].label}

Create educational content that includes:

1. **LEARNING OBJECTIVES** (3-5 specific, measurable objectives)

2. **KEY CONCEPTS** (Core principles and definitions)

3. **BEST PRACTICES** (5-7 actionable best practices with examples)

4. **COMMON MISTAKES** (What to avoid and why)

5. **REAL-WORLD SCENARIOS** (2-3 case examples showing correct approach)

6. **QUICK REFERENCE TIPS** (Bullet points for daily use)

7. **REGULATORY REFERENCES** (Relevant Medicare/CMS guidelines if applicable)

Make content practical, specific to home health nursing, and immediately applicable.
Use professional but accessible language.`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            estimated_time: { type: "number" },
            learning_objectives: { type: "array", items: { type: "string" } },
            key_concepts: { type: "array", items: { 
              type: "object",
              properties: {
                term: { type: "string" },
                definition: { type: "string" }
              }
            }},
            best_practices: { type: "array", items: {
              type: "object",
              properties: {
                practice: { type: "string" },
                example: { type: "string" },
                rationale: { type: "string" }
              }
            }},
            common_mistakes: { type: "array", items: {
              type: "object",
              properties: {
                mistake: { type: "string" },
                consequence: { type: "string" },
                correction: { type: "string" }
              }
            }},
            scenarios: { type: "array", items: {
              type: "object",
              properties: {
                situation: { type: "string" },
                correct_approach: { type: "string" },
                key_takeaway: { type: "string" }
              }
            }},
            quick_tips: { type: "array", items: { type: "string" } },
            regulatory_references: { type: "array", items: { type: "string" } }
          }
        }
      });

      setGeneratedContent(result);
      onContentGenerated?.(result);
    } catch (error) {
      console.error("Error generating training content:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const category = trainingTopics[selectedCategory];
  const _Icon = category.icon;

  return (
    <div className="space-y-4">
      {/* Category Selection */}
      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        <TabsList className="grid grid-cols-3 w-full">
          {Object.entries(trainingTopics).map(([key, cat]) => {
            const CatIcon = cat.icon;
            return (
              <TabsTrigger key={key} value={key} className="flex items-center gap-2">
                <CatIcon className="w-4 h-4" />
                <span className="hidden sm:inline">{cat.label.split(' ')[0]}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {Object.entries(trainingTopics).map(([key, cat]) => (
          <TabsContent key={key} value={key} className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {cat.subtopics.map((topic, idx) => (
                <Card
                  key={idx}
                  className={`cursor-pointer hover:shadow-md transition-all ${
                    selectedTopic === topic ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => generateTrainingContent(topic)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg bg-${cat.color}-100 flex items-center justify-center flex-shrink-0`}>
                        <BookOpen className={`w-4 h-4 text-${cat.color}-600`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{topic}</p>
                        <p className="text-xs text-slate-500 mt-1">Click to generate</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Loading State */}
      {ai.loading && (
        <Card className="border-2 border-blue-200 bg-blue-50">
          <CardContent className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-blue-900">Generating Training Content...</p>
            <p className="text-xs text-blue-700 mt-1">Creating comprehensive materials for: {selectedTopic}</p>
          </CardContent>
        </Card>
      )}

      {/* Generated Content Display */}
      {generatedContent && !ai.loading && (
        <Card className="border-2 border-green-200">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-green-600" />
                {generatedContent.title}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {generatedContent.estimated_time} min
                </Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-6">
            {/* Learning Objectives */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-600" />
                Learning Objectives
              </h3>
              <ul className="space-y-1">
                {generatedContent.learning_objectives?.map((obj, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    {obj}
                  </li>
                ))}
              </ul>
            </div>

            {/* Key Concepts */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Key Concepts</h3>
              <div className="grid gap-2">
                {generatedContent.key_concepts?.map((concept, idx) => (
                  <div key={idx} className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-sm font-medium text-slate-900">{concept.term}</p>
                    <p className="text-xs text-slate-600 mt-1">{concept.definition}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Best Practices */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Best Practices</h3>
              <div className="space-y-3">
                {generatedContent.best_practices?.map((bp, idx) => (
                  <div key={idx} className="border-l-4 border-green-500 pl-3 py-2">
                    <p className="text-sm font-medium text-slate-900">{bp.practice}</p>
                    <p className="text-xs text-slate-600 mt-1"><strong>Example:</strong> {bp.example}</p>
                    <p className="text-xs text-green-700 mt-1"><strong>Why:</strong> {bp.rationale}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Common Mistakes */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Common Mistakes to Avoid</h3>
              <div className="space-y-2">
                {generatedContent.common_mistakes?.map((mistake, idx) => (
                  <div key={idx} className="bg-red-50 p-3 rounded-lg border border-red-200">
                    <p className="text-sm font-medium text-red-800">❌ {mistake.mistake}</p>
                    <p className="text-xs text-red-700 mt-1">{mistake.consequence}</p>
                    <p className="text-xs text-green-700 mt-1">✓ {mistake.correction}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Scenarios */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Real-World Scenarios</h3>
              <div className="space-y-3">
                {generatedContent.scenarios?.map((scenario, idx) => (
                  <div key={idx} className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-sm font-medium text-blue-900">Scenario {idx + 1}:</p>
                    <p className="text-xs text-slate-700 mt-1">{scenario.situation}</p>
                    <p className="text-xs text-blue-800 mt-2"><strong>Correct Approach:</strong> {scenario.correct_approach}</p>
                    <p className="text-xs text-green-700 mt-1"><strong>Key Takeaway:</strong> {scenario.key_takeaway}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Tips */}
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <h3 className="text-sm font-semibold text-yellow-800 mb-2">💡 Quick Reference Tips</h3>
              <ul className="space-y-1">
                {generatedContent.quick_tips?.map((tip, idx) => (
                  <li key={idx} className="text-xs text-yellow-900">• {tip}</li>
                ))}
              </ul>
            </div>

            {/* Regulatory References */}
            {generatedContent.regulatory_references?.length > 0 && (
              <div className="bg-slate-100 p-3 rounded-lg">
                <h3 className="text-xs font-semibold text-slate-700 mb-1">Regulatory References:</h3>
                <ul className="space-y-0.5">
                  {generatedContent.regulatory_references.map((ref, idx) => (
                    <li key={idx} className="text-xs text-slate-600">• {ref}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}