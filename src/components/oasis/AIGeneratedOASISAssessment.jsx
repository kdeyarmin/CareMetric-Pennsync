import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Save,
  Edit
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from 'sonner';

export default function AIGeneratedOASISAssessment({ patientId, visitId, visitType = "Start of Care", referralData, onSaved }) {
  const queryClient = useQueryClient();
  const [assessment, setAssessment] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedItems, setExpandedItems] = useState([]);
  const [copiedItems, setCopiedItems] = useState([]);
  const [editingItems, setEditingItems] = useState({});

  const generateAssessment = async () => {
    setIsGenerating(true);
    try {
      const payload = {
        visit_type: visitType
      };

      if (patientId) {
        payload.patient_id = patientId;
      } else if (referralData) {
        payload.referral_data = referralData;
      }

      const { data } = await base44.functions.invoke('generateOASISAssessment', payload);
      
      // Filter out administrative items
      if (data.oasis_items) {
        data.oasis_items = data.oasis_items.filter(item => {
          const itemNum = item.item_number?.toUpperCase() || '';
          const numMatch = itemNum.match(/M(\d+)/);
          if (numMatch) {
            const num = parseInt(numMatch[1]);
            if (num >= 1000 && num <= 1060) return false;
          }
          return true;
        });
      }
      
      setAssessment(data);
    } catch (error) {
      console.error('Error generating OASIS assessment:', error);
      toast.error('Failed to generate OASIS assessment. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveAssessment = async () => {
    if (!assessment || !patientId) return;
    
    setIsSaving(true);
    try {
      // Apply edited values to assessment
      const updatedItems = (assessment.oasis_items || []).map(item => ({
        ...item,
        response: editingItems[item.item_number] !== undefined ? editingItems[item.item_number] : item.suggested_response,
        manually_edited: editingItems[item.item_number] !== undefined,
        ai_suggested: true
      }));

      const completedCount = updatedItems.filter(item => item.response).length;
      const completionPercentage = updatedItems.length
        ? Math.round((completedCount / updatedItems.length) * 100)
        : 0;

      const oasisData = {
        patient_id: patientId,
        visit_id: visitId || null,
        visit_type: visitType,
        assessment_date: new Date().toISOString().split('T')[0],
        oasis_items: updatedItems,
        clinical_summary: assessment.clinical_summary,
        estimated_pdgm_group: assessment.estimated_pdgm_group,
        status: completionPercentage === 100 ? 'completed' : 'in_progress',
        completion_percentage: completionPercentage
      };

      await base44.entities.OASISAssessment.create(oasisData);
      
      queryClient.invalidateQueries({ queryKey: ['oasisAssessments', patientId] });
      onSaved?.();
      
      toast.success('OASIS assessment saved successfully!');
    } catch (error) {
      console.error('Error saving OASIS assessment:', error);
      toast.error('Failed to save OASIS assessment. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateItemResponse = (itemNumber, newValue) => {
    setEditingItems(prev => ({
      ...prev,
      [itemNumber]: newValue
    }));
  };

  const toggleItemExpand = (index) => {
    setExpandedItems(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const copyItemToClipboard = (item) => {
    const text = `${item.item_number}: ${item.item_name}
Suggested Response: ${item.suggested_response}
Rationale: ${item.rationale}

Questions to Ask:
${item.questions_to_ask?.map(q => `• ${q}`).join('\n')}

Documentation Tips:
${item.documentation_tips?.map(t => `• ${t}`).join('\n')}`;

    navigator.clipboard.writeText(text);
    setCopiedItems(prev => [...prev, item.item_number]);
    setTimeout(() => {
      setCopiedItems(prev => prev.filter(i => i !== item.item_number));
    }, 2000);
  };

  const getConfidenceBadgeColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'high':
        return 'bg-green-600';
      case 'medium':
        return 'bg-yellow-600';
      case 'low':
        return 'bg-orange-600';
      default:
        return 'bg-slate-600';
    }
  };

  if (!assessment) {
    return (
      <Card className="border-2 border-indigo-300 bg-indigo-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
            <ClipboardList className="w-4 h-4" />
            AI-Generated OASIS Assessment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-indigo-800 mb-3">
            Generate intelligent OASIS assessment suggestions based on patient data, diagnoses, and care plans.
          </p>
          <Button
            onClick={generateAssessment}
            disabled={isGenerating}
            className="bg-indigo-600 hover:bg-indigo-700 w-full"
          >
            {isGenerating ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                Generating Assessment...
              </>
            ) : (
              <>
                <ClipboardList className="w-4 h-4 mr-2" />
                Generate OASIS Assessment
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-indigo-300 bg-indigo-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
            <ClipboardList className="w-4 h-4" />
            AI-Generated OASIS Assessment
          </CardTitle>
          <Badge className="bg-indigo-600 text-white">
            {assessment.oasis_items?.length || 0} items
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Clinical Summary */}
        {assessment.clinical_summary && (
          <Alert className="bg-blue-50 border-blue-300">
            <FileText className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-xs text-blue-900">
              <strong>Clinical Summary:</strong> {assessment.clinical_summary}
            </AlertDescription>
          </Alert>
        )}

        {/* PDGM Estimate */}
        {assessment.estimated_pdgm_group && (
          <Alert className="bg-navy-50 border-navy-300">
            <TrendingUp className="w-4 h-4 text-navy-600" />
            <AlertDescription className="text-xs text-navy-900">
              <strong>Estimated PDGM Group:</strong> {assessment.estimated_pdgm_group}
            </AlertDescription>
          </Alert>
        )}

        {/* Assessment Priorities */}
        {assessment.assessment_priorities?.length > 0 && (
          <Card className="bg-white">
            <CardContent className="p-3">
              <h4 className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-orange-600" />
                Assessment Priorities
              </h4>
              <div className="space-y-2">
                {assessment.assessment_priorities.map((priority, idx) => (
                  <div key={idx} className="bg-orange-50 border border-orange-200 rounded p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-orange-600 text-white text-xs">{priority.priority}</Badge>
                      <span className="text-xs font-semibold text-slate-900">{priority.area}</span>
                    </div>
                    <p className="text-xs text-slate-700">{priority.rationale}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Missing Data Alert */}
        {assessment.missing_critical_data?.length > 0 && (
          <Alert className="bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription>
              <p className="text-xs font-semibold text-red-900 mb-1">Critical Missing Data:</p>
              <ul className="space-y-1">
                {assessment.missing_critical_data.map((item, idx) => (
                  <li key={idx} className="text-xs text-red-800">• {item}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* OASIS Items */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="w-full grid grid-cols-4 h-auto">
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            <TabsTrigger value="functional" className="text-xs">Functional</TabsTrigger>
            <TabsTrigger value="clinical" className="text-xs">Clinical</TabsTrigger>
            <TabsTrigger value="cognitive" className="text-xs">Cognitive</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(item => {
              // Filter out administrative items M1000-M1060
              const itemNum = item.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060) return false;
              }
              return true;
            }).map((item, idx) => {
              const isExpanded = expandedItems.includes(idx);
              const isCopied = copiedItems.includes(item.item_number);

              return (
                <div
                  key={idx}
                  className="bg-white border border-indigo-200 rounded-lg overflow-hidden"
                >
                  <div
                    className="p-3 cursor-pointer hover:bg-indigo-50 transition-colors"
                    onClick={() => toggleItemExpand(idx)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">{item.item_number}</Badge>
                          <Badge className={`${getConfidenceBadgeColor(item.confidence_level)} text-white text-xs`}>
                            {item.confidence_level}
                          </Badge>
                          {item.category && (
                            <Badge className="bg-slate-600 text-white text-xs">{item.category}</Badge>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-slate-900 mb-1">{item.item_name}</p>
                        <p className="text-xs text-slate-700">
                          <strong>Suggested:</strong> {item.suggested_response}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyItemToClipboard(item);
                          }}
                          className="h-8 w-8 p-0"
                        >
                          {isCopied ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-indigo-200 bg-indigo-50 p-3 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-2">
                          <Edit className="w-3 h-3" />
                          Edit Response:
                        </p>
                        <Textarea
                          value={editingItems[item.item_number] !== undefined ? editingItems[item.item_number] : item.suggested_response}
                          onChange={(e) => updateItemResponse(item.item_number, e.target.value)}
                          className="text-xs min-h-[60px]"
                          placeholder="Enter OASIS response..."
                        />
                        {editingItems[item.item_number] !== undefined && (
                          <Badge className="bg-blue-600 text-white text-xs mt-1">Edited</Badge>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-slate-900 mb-1">Rationale:</p>
                        <p className="text-xs text-slate-700">{item.rationale}</p>
                      </div>

                      {item.questions_to_ask?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-900 mb-1 flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            Questions to Ask:
                          </p>
                          <ul className="space-y-1">
                            {item.questions_to_ask.map((q, qidx) => (
                              <li key={qidx} className="text-xs text-slate-700 bg-white p-2 rounded">• {q}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {item.documentation_tips?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-900 mb-1">Documentation Tips:</p>
                          <ul className="space-y-1">
                            {item.documentation_tips.map((tip, tidx) => (
                              <li key={tidx} className="text-xs text-slate-700">• {tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {item.pdgm_impact && (
                        <div className="bg-navy-100 border border-navy-300 rounded p-2">
                          <p className="text-xs font-semibold text-navy-900 mb-1">PDGM Impact:</p>
                          <p className="text-xs text-navy-800">{item.pdgm_impact}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="functional" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(i => {
              const itemNum = i.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060) return false;
              }
              return i.category?.toLowerCase().includes('functional');
            }).map((item, idx) => (
              <div key={idx} className="text-xs bg-white border border-indigo-200 rounded p-2">
                <strong>{item.item_number}:</strong> {item.item_name} - {item.suggested_response}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="clinical" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(i => {
              const itemNum = i.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060) return false;
              }
              return i.category?.toLowerCase().includes('clinical');
            }).map((item, idx) => (
              <div key={idx} className="text-xs bg-white border border-indigo-200 rounded p-2">
                <strong>{item.item_number}:</strong> {item.item_name} - {item.suggested_response}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="cognitive" className="space-y-2 mt-3">
            {assessment.oasis_items?.filter(i => {
              const itemNum = i.item_number?.toUpperCase() || '';
              const numMatch = itemNum.match(/M(\d+)/);
              if (numMatch) {
                const num = parseInt(numMatch[1]);
                if (num >= 1000 && num <= 1060) return false;
              }
              return i.category?.toLowerCase().includes('cognitive');
            }).map((item, idx) => (
              <div key={idx} className="text-xs bg-white border border-indigo-200 rounded p-2">
                <strong>{item.item_number}:</strong> {item.item_name} - {item.suggested_response}
              </div>
            ))}
          </TabsContent>
        </Tabs>

        {/* PDGM Optimization Notes */}
        {assessment.pdgm_optimization_notes?.length > 0 && (
          <Alert className="bg-green-50 border-green-300">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <AlertDescription>
              <p className="text-xs font-semibold text-green-900 mb-1">PDGM Optimization:</p>
              <ul className="space-y-1">
                {assessment.pdgm_optimization_notes.map((note, idx) => (
                  <li key={idx} className="text-xs text-green-800">• {note}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={saveAssessment}
            disabled={isSaving || !patientId}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Assessment
              </>
            )}
          </Button>
          <Button
            onClick={generateAssessment}
            variant="outline"
            size="sm"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Regenerate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}