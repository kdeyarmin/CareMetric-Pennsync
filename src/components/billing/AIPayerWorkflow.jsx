import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Loader2, 
  Sparkles, 
  Globe, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  AlertCircle,
  Plus
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function AIPayerWorkflow({ onPayerCreated }) {
  const [inputMode, setInputMode] = useState('url'); // 'url' or 'document'
  const [sourceUrl, setSourceUrl] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [payerNameHint, setPayerNameHint] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const extractInformation = async () => {
    if (!sourceUrl && !documentText) {
      toast.error('Please provide a URL or document text');
      return;
    }

    setExtracting(true);
    try {
      const response = await base44.functions.invoke('extractPayerInformation', {
        source_url: inputMode === 'url' ? sourceUrl : null,
        document_text: inputMode === 'document' ? documentText : null,
        payer_name_hint: payerNameHint
      });

      setExtractedData(response.data.extracted_data);
      
      const confidence = response.data.extracted_data.confidence_score;
      if (confidence >= 80) {
        toast.success(`Extraction complete - ${confidence}% confidence`);
      } else if (confidence >= 60) {
        toast.warning(`Extraction complete - ${confidence}% confidence (review recommended)`);
      } else {
        toast.warning(`Low confidence extraction (${confidence}%) - manual review required`);
      }
    } catch (error) {
      console.error('Error extracting:', error);
      toast.error('Failed to extract payer information');
    } finally {
      setExtracting(false);
    }
  };

  const createPayer = async () => {
    setCreating(true);
    try {
      const billingCodes = extractedData.suggested_billing_codes?.map(code => ({
        code: code.code,
        code_type: code.code_type,
        description: code.description,
        modifier_codes: code.modifier_codes || [],
        requirements: code.requirements || []
      })) || [];

      const newPayer = await base44.entities.Payer.create({
        payer_name: extractedData.payer_name,
        payer_id: extractedData.payer_id || '',
        payer_type: extractedData.payer_type,
        states: extractedData.states || [],
        applicable_provider_types: extractedData.applicable_provider_types || ['All'],
        contact_info: extractedData.contact_info || {},
        electronic_submission_id: extractedData.electronic_submission_id || '',
        timely_filing_limit_days: extractedData.timely_filing_limit_days || 90,
        prior_authorization_required: extractedData.prior_authorization_required || false,
        general_requirements: extractedData.general_requirements || [],
        billing_codes: billingCodes,
        notes: extractedData.notes || 'AI-extracted payer information',
        is_active: true
      });

      toast.success('Payer created successfully!');
      queryClient.invalidateQueries(['payers']);
      
      // Reset form
      setExtractedData(null);
      setSourceUrl('');
      setDocumentText('');
      setPayerNameHint('');
      
      if (onPayerCreated) {
        onPayerCreated(newPayer);
      }
    } catch (error) {
      console.error('Error creating payer:', error);
      toast.error('Failed to create payer');
    } finally {
      setCreating(false);
    }
  };

  const updateField = (field, value) => {
    setExtractedData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const getConfidenceColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-purple-200 dark:border-purple-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          AI Payer Workflow
        </CardTitle>
        <CardDescription>
          Automatically extract payer information from websites or documents
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!extractedData ? (
          <>
            <Tabs value={inputMode} onValueChange={setInputMode}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="url">
                  <Globe className="w-4 h-4 mr-2" />
                  Website URL
                </TabsTrigger>
                <TabsTrigger value="document">
                  <FileText className="w-4 h-4 mr-2" />
                  Document Text
                </TabsTrigger>
              </TabsList>

              <TabsContent value="url" className="space-y-3">
                <div>
                  <Label>Payer Website URL</Label>
                  <Input
                    type="url"
                    placeholder="https://www.payerwebsite.com/provider-info"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Provide the payer's provider information or billing guidelines page
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="document" className="space-y-3">
                <div>
                  <Label>Payer Document Text</Label>
                  <Textarea
                    placeholder="Paste payer information from documents, PDFs, or provider manuals..."
                    value={documentText}
                    onChange={(e) => setDocumentText(e.target.value)}
                    rows={8}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Copy and paste text from payer documents, fee schedules, or provider guides
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <div>
              <Label>Payer Name (Optional)</Label>
              <Input
                placeholder="e.g., Blue Cross Blue Shield California"
                value={payerNameHint}
                onChange={(e) => setPayerNameHint(e.target.value)}
              />
              <p className="text-xs text-slate-500 mt-1">
                Provide a hint to help AI identify the correct payer name
              </p>
            </div>

            <Button
              onClick={extractInformation}
              disabled={extracting || (!sourceUrl && !documentText)}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting Information...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Extract Payer Information
                </>
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            {/* Confidence Score */}
            <Alert className={
              extractedData.confidence_score >= 80 ? 'bg-green-50 border-green-200' :
              extractedData.confidence_score >= 60 ? 'bg-yellow-50 border-yellow-200' :
              'bg-red-50 border-red-200'
            }>
              <AlertDescription>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Extraction Confidence:</span>
                  <Badge className={getConfidenceColor(extractedData.confidence_score)}>
                    {extractedData.confidence_score}%
                  </Badge>
                </div>
              </AlertDescription>
            </Alert>

            {/* Ambiguities */}
            {extractedData.ambiguities && extractedData.ambiguities.length > 0 && (
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                <AlertDescription>
                  <p className="font-medium text-yellow-900 mb-2">Ambiguities Detected:</p>
                  <ul className="space-y-1">
                    {extractedData.ambiguities.map((amb, idx) => (
                      <li key={idx} className="text-sm text-yellow-800">
                        <strong>{amb.field}:</strong> {amb.issue}
                        {amb.suggestion && <span className="block text-xs mt-1">→ {amb.suggestion}</span>}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Missing Critical Info */}
            {extractedData.missing_critical_info && extractedData.missing_critical_info.length > 0 && (
              <Alert className="bg-red-50 border-red-200">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <AlertDescription>
                  <p className="font-medium text-red-900 mb-1">Missing Critical Information:</p>
                  <div className="flex flex-wrap gap-1">
                    {extractedData.missing_critical_info.map((field, idx) => (
                      <Badge key={idx} className="bg-red-600 text-white">{field}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-red-700 mt-2">Review and add this information manually before creating</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Extracted Data - Editable */}
            <Card className="bg-slate-50 dark:bg-slate-900">
              <CardHeader>
                <CardTitle className="text-sm">Review & Edit Extracted Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Payer Name</Label>
                    <Input
                      value={extractedData.payer_name || ''}
                      onChange={(e) => updateField('payer_name', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Payer ID</Label>
                    <Input
                      value={extractedData.payer_id || ''}
                      onChange={(e) => updateField('payer_id', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Payer Type</Label>
                    <Input
                      value={extractedData.payer_type || ''}
                      onChange={(e) => updateField('payer_type', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>States (comma-separated)</Label>
                    <Input
                      value={extractedData.states?.join(', ') || ''}
                      onChange={(e) => updateField('states', e.target.value.split(',').map(s => s.trim()))}
                    />
                  </div>
                </div>

                <div>
                  <Label>Contact Website</Label>
                  <Input
                    value={extractedData.contact_info?.website || ''}
                    onChange={(e) => updateField('contact_info', {
                      ...extractedData.contact_info,
                      website: e.target.value
                    })}
                  />
                </div>

                {extractedData.suggested_billing_codes && extractedData.suggested_billing_codes.length > 0 && (
                  <div>
                    <Label>Suggested Billing Codes ({extractedData.suggested_billing_codes.length})</Label>
                    <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                      {extractedData.suggested_billing_codes.map((code, idx) => (
                        <div key={idx} className="bg-white dark:bg-slate-800 p-2 rounded border">
                          <div className="flex items-center justify-between">
                            <div>
                              <Badge className="bg-indigo-600 text-white mr-2">{code.code}</Badge>
                              <span className="text-sm">{code.description}</span>
                            </div>
                            <Badge variant="outline">{code.confidence}%</Badge>
                          </div>
                          {code.modifier_codes && code.modifier_codes.length > 0 && (
                            <p className="text-xs text-slate-600 mt-1">
                              Modifiers: {code.modifier_codes.join(', ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {extractedData.notes && (
                  <div>
                    <Label>Additional Notes</Label>
                    <Textarea
                      value={extractedData.notes}
                      onChange={(e) => updateField('notes', e.target.value)}
                      rows={3}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={createPayer}
                disabled={creating}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Payer
                  </>
                )}
              </Button>
              <Button
                onClick={() => setExtractedData(null)}
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}