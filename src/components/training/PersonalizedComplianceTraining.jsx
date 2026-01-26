import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, BookOpen, Target, CheckCircle2, FileText } from "lucide-react";
import { generateComplianceTraining } from "@/functions/generateComplianceTraining";
import { toast } from "sonner";

export default function PersonalizedComplianceTraining({ errorPatterns, userEmail, onTrainingGenerated }) {
  const [generating, setGenerating] = useState(false);
  const [trainingContent, setTrainingContent] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await generateComplianceTraining({
        user_email: userEmail,
        error_patterns: errorPatterns.map(p => ({
          pattern: p.rule_name,
          rule_name: p.rule_name,
          count: p.count,
          severity: p.severity,
          examples: p.examples
        }))
      });

      if (response.data.success) {
        setTrainingContent(response.data.training_module);
        toast.success("Personalized training generated!");
        onTrainingGenerated?.(response.data);
      } else {
        throw new Error(response.data.error || 'Generation failed');
      }
    } catch (error) {
      toast.error("Failed to generate training: " + error.message);
    } finally {
      setGenerating(false);
    }
  };

  if (!trainingContent) {
    return (
      <Card className="border-purple-200 bg-purple-50">
        <CardContent className="p-6 text-center">
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Your Training...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate My Personalized Training
              </>
            )}
          </Button>
          <p className="text-xs text-purple-700 mt-2">
            AI will create a custom training module based on your specific compliance errors
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-purple-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            {trainingContent.module_title}
          </CardTitle>
          <Badge className="bg-purple-600">
            {trainingContent.estimated_time_minutes} min
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="learn">Learn</TabsTrigger>
            <TabsTrigger value="practice">Practice</TabsTrigger>
            <TabsTrigger value="reference">Reference</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="space-y-4">
            <div className="prose prose-sm max-w-none">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600" />
                What You'll Learn
              </h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{trainingContent.overview}</p>
            </div>

            <div>
              <h3 className="text-base font-semibold mb-2 flex items-center gap-2">
                <Target className="w-4 h-4 text-green-600" />
                Learning Objectives
              </h3>
              <ul className="space-y-2">
                {trainingContent.learning_objectives.map((obj, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{obj}</span>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>

          {/* Learning Content */}
          <TabsContent value="learn" className="space-y-4">
            <ScrollArea className="h-96">
              <div className="space-y-4 pr-4">
                {trainingContent.key_concepts.map((concept, idx) => (
                  <Card key={idx} className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4">
                      <h4 className="font-semibold text-sm mb-2">{concept.concept}</h4>
                      <p className="text-sm text-gray-700 mb-2">{concept.explanation}</p>
                      <div className="p-2 bg-blue-50 rounded border border-blue-200">
                        <p className="text-xs font-semibold text-blue-900">Why It Matters:</p>
                        <p className="text-xs text-blue-800">{concept.why_it_matters}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <div>
                  <h3 className="text-base font-semibold mb-3">Best Practices</h3>
                  {trainingContent.best_practices.map((practice, idx) => (
                    <Card key={idx} className="mb-3 border-green-200 bg-green-50">
                      <CardContent className="p-4">
                        <h4 className="font-semibold text-sm mb-2 text-green-900">{practice.practice}</h4>
                        <div className="space-y-2">
                          <div>
                            <p className="text-xs font-semibold text-gray-700">Steps:</p>
                            <ol className="list-decimal list-inside space-y-1 mt-1">
                              {practice.steps.map((step, i) => (
                                <li key={i} className="text-xs text-gray-800">{step}</li>
                              ))}
                            </ol>
                          </div>
                          {practice.common_pitfalls?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-red-700">Common Pitfalls to Avoid:</p>
                              <ul className="space-y-1 mt-1">
                                {practice.common_pitfalls.map((pitfall, i) => (
                                  <li key={i} className="text-xs text-red-600">⚠️ {pitfall}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Scenarios */}
          <TabsContent value="practice" className="space-y-4">
            <ScrollArea className="h-96">
              <div className="space-y-3 pr-4">
                {trainingContent.scenarios.map((scenario, idx) => (
                  <Card key={idx} className="border-purple-200">
                    <CardContent className="p-4">
                      <Badge className="bg-purple-600 mb-2">Scenario {idx + 1}</Badge>
                      <h4 className="font-semibold text-sm mb-2">{scenario.title}</h4>
                      <div className="p-3 bg-gray-50 rounded border mb-3">
                        <p className="text-sm text-gray-800">{scenario.scenario}</p>
                      </div>
                      <div className="p-3 bg-green-50 rounded border border-green-200">
                        <p className="text-xs font-semibold text-green-900">✓ Correct Approach:</p>
                        <p className="text-sm text-green-800 mt-1">{scenario.correct_approach}</p>
                        <p className="text-xs text-green-700 mt-2 italic">{scenario.why_correct}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Quick Reference */}
          <TabsContent value="reference">
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold">Quick Reference Checklist</h3>
                </div>
                <ul className="space-y-2">
                  {trainingContent.quick_reference_checklist.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 p-2 bg-white rounded border">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-gray-800">{item}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const text = trainingContent.quick_reference_checklist.join('\n');
                    navigator.clipboard.writeText(text);
                    toast.success("Checklist copied to clipboard!");
                  }}
                  className="w-full mt-3"
                >
                  Copy Checklist
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}