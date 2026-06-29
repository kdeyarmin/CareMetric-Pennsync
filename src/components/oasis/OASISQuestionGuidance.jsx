import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Lightbulb, BookOpen, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { OASIS_GUIDANCE } from './oasisGuidanceData';

export default function OASISQuestionGuidance({ questionId, questionLabel, isOpen, onClose }) {
  const guidance = OASIS_GUIDANCE[questionId];

  if (!guidance) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <DialogTitle className="text-lg font-bold text-slate-900 pr-8">
              {questionLabel}
            </DialogTitle>
            <p className="text-sm text-slate-900 font-medium mt-1">{guidance.description}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute right-4 top-4"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <Tabs defaultValue="scenarios" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="scenarios" className="text-xs">
              <Lightbulb className="w-3 h-3 mr-1.5" />
              Real-World Scenarios
            </TabsTrigger>
            <TabsTrigger value="guidance" className="text-xs">
              <BookOpen className="w-3 h-3 mr-1.5" />
              How to Answer
            </TabsTrigger>
            <TabsTrigger value="tips" className="text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1.5" />
              Best Practices
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scenarios" className="mt-4 space-y-3">
            {guidance.scenarios.map((scenario, idx) => (
              <Card key={idx} className="border-l-4 bg-white" style={{ borderLeftColor: scenario.color || '#264491' }}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm text-slate-900 mb-2">
                        {scenario.title}
                      </h4>
                      <p className="text-sm text-slate-900 font-normal mb-3">
                        {scenario.description}
                      </p>
                      <div className="bg-white border-2 border-indigo-300 rounded-lg p-3">
                        <p className="text-xs font-bold text-indigo-700 mb-1">
                          Recommended Answer:
                        </p>
                        <p className="text-sm font-semibold text-slate-900">
                          {scenario.recommendedAnswer}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="guidance" className="mt-4 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-sm text-blue-900 mb-2 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Clinical Assessment Guidelines
              </h4>
              <div className="space-y-2 text-sm text-slate-900">
                {guidance.howToAnswer.map((tip, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p>{tip}</p>
                  </div>
                ))}
              </div>
            </div>

            {guidance.redFlags && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-red-900 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Red Flags to Watch For
                </h4>
                <div className="space-y-2 text-sm text-slate-900">
                  {guidance.redFlags.map((flag, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <p>{flag}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="tips" className="mt-4 space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-sm text-green-900 mb-3">
                Documentation Best Practices
              </h4>
              <ul className="space-y-2 text-sm text-slate-900">
                {guidance.bestPractices.map((practice, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span>{practice}</span>
                  </li>
                ))}
              </ul>
            </div>

            {guidance.complianceTips && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-amber-900 mb-3">
                  Medicare Compliance Tips
                </h4>
                <ul className="space-y-2 text-sm text-slate-900">
                  {guidance.complianceTips.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-amber-600 font-bold">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}