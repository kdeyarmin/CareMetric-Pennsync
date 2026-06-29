import { useState } from "react";
import { invokeLLM } from "@/lib/invokeLLM";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Loader2, CheckCircle, Lightbulb, Wand2 } from "lucide-react";
import { toast } from "sonner";

export default function ClinicalLibraryAIAssistant({ 
  mode, // 'improve', 'generate', 'refine'
  currentTemplate,
  onApplySuggestion
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [generatedTemplate, setGeneratedTemplate] = useState(null);

  const startGeneration = async () => {
    setIsProcessing(true);
    try {
      const response = await invokeLLM({
        model: "claude_sonnet_4_6",
        prompt: `You are an expert clinical documentation assistant helping create a quick phrase template for home health/hospice nurses.

Ask the user 3-4 focused questions to understand what they want to create:
1. What type of clinical documentation is this for? (e.g., patient education, assessment, wound care, medication review)
2. Should it be generic (same text for all patients) or patient-specific (pulls individual patient data)?
3. What are the key elements that must be included in this documentation?

Keep your response conversational and ask ONE question at a time. Start with the first question.`,
      });

      setConversation([{
        role: 'assistant',
        content: response
      }]);
    } catch {
      toast.error('Failed to start AI assistant');
    }
    setIsProcessing(false);
  };

  const continueConversation = async () => {
    if (!userInput.trim()) return;

    const newMessage = { role: 'user', content: userInput };
    const updatedConversation = [...conversation, newMessage];
    setConversation(updatedConversation);
    setUserInput('');
    setIsProcessing(true);

    try {
      const conversationHistory = updatedConversation
        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');

      const shouldGenerate = updatedConversation.filter(m => m.role === 'user').length >= 3;

      if (shouldGenerate) {
        const response = await invokeLLM({
          model: "claude_sonnet_4_6",
          prompt: `Based on this conversation about creating a clinical template:

${conversationHistory}

Generate a complete template with the following structure:
{
  "phrase": "short trigger phrase in lowercase",
  "category": "one of: education, assessment, intervention, wound_care, medication, vital_signs, safety, communication, other",
  "template_type": "generic or patient_specific",
  "expanded_text": "full Medicare-compliant documentation text (if generic)",
  "ai_prompt_instructions": "detailed instructions for AI to generate patient-specific text (if patient_specific)",
  "patient_data_fields": ["array", "of", "fields"] (if patient_specific, e.g., wounds, medications, diagnoses)
}

Respond with ONLY the JSON object, no additional text.`,
          response_json_schema: {
            type: "object",
            properties: {
              phrase: { type: "string" },
              category: { type: "string" },
              template_type: { type: "string" },
              expanded_text: { type: "string" },
              ai_prompt_instructions: { type: "string" },
              patient_data_fields: { type: "array", items: { type: "string" } }
            }
          }
        });

        setGeneratedTemplate(response);
        setConversation([...updatedConversation, {
          role: 'assistant',
          content: 'Great! I\'ve generated a template based on your inputs. Review it below and click "Apply" to use it.'
        }]);
      } else {
        const response = await invokeLLM({
          model: "claude_sonnet_4_6",
          prompt: `Continue this conversation about creating a clinical template:

${conversationHistory}

Ask the next relevant question to gather information. Keep it conversational and focused. If you have enough information after this response, let the user know you'll generate the template next.`
        });

        setConversation([...updatedConversation, {
          role: 'assistant',
          content: response
        }]);
      }
    } catch {
      toast.error('AI processing failed');
      setConversation([...updatedConversation, {
        role: 'assistant',
        content: 'I encountered an error. Please try again.'
      }]);
    }
    setIsProcessing(false);
  };

  const improveCurrent = async () => {
    setIsProcessing(true);
    try {
      const templateText = currentTemplate.template_type === 'generic' 
        ? currentTemplate.expanded_text 
        : currentTemplate.ai_prompt_instructions;

      const response = await invokeLLM({
        model: "claude_sonnet_4_6",
        prompt: `Analyze this clinical documentation template and suggest improvements based on Medicare compliance best practices:

**Current Template:**
Phrase: "${currentTemplate.phrase}"
Category: ${currentTemplate.category}
Type: ${currentTemplate.template_type}

${currentTemplate.template_type === 'generic' ? 'Text:' : 'AI Instructions:'}
${templateText}

${currentTemplate.template_type === 'patient_specific' ? `Patient Data Fields: ${currentTemplate.patient_data_fields?.join(', ')}` : ''}

Provide specific, actionable suggestions for:
1. Medicare compliance and documentation requirements
2. Clinical accuracy and completeness
3. Clarity and professionalism
4. Missing key elements

Format as a bulleted list of improvements.`
      });

      setConversation([{
        role: 'assistant',
        content: response
      }]);
    } catch {
      toast.error('Failed to analyze template');
    }
    setIsProcessing(false);
  };

  const refineInstructions = async () => {
    setIsProcessing(true);
    try {
      const response = await invokeLLM({
        model: "claude_sonnet_4_6",
        prompt: `You are an expert in clinical documentation best practices for Medicare home health and hospice. Analyze and improve these AI instructions for generating patient-specific clinical documentation.

**Current Instructions:**
${currentTemplate.ai_prompt_instructions}

**Patient Data Fields Available:**
${currentTemplate.patient_data_fields?.join(', ') || 'None specified'}

**Context:**
- Quick Phrase: "${currentTemplate.phrase}"
- Category: ${currentTemplate.category}
- This template will be used by nurses to quickly document ${currentTemplate.category} activities in patient charts.

Provide your analysis in this structure:

**ANALYSIS:**
- Identify strengths in the current instructions
- Point out gaps or ambiguities
- Note any Medicare compliance issues
- Assess clarity and specificity

**REFINED INSTRUCTIONS (READY TO USE):**
[Provide improved instructions that are:]
1. Specific and actionable - tell the AI exactly what to generate
2. Clear about which patient data fields to use and how to integrate them naturally
3. Structured to produce Medicare-compliant documentation with proper medical terminology
4. Include format guidelines (e.g., use complete sentences, include measurements, specify tense)
5. Emphasize skilled nursing observations and interventions
6. Include any required documentation elements for the category (e.g., for education: teaching method, patient/caregiver response, comprehension)

**ALTERNATIVE APPROACHES:**
[Suggest 2-3 alternative phrasings or structures that could work well, explaining when each would be most appropriate]

**BEST PRACTICES TIPS:**
- Key Medicare documentation requirements for this category
- Common pitfalls to avoid
- Ways to make the output more specific and measurable`
      });

      setConversation([{
        role: 'assistant',
        content: response
      }]);

      // Also provide a button to directly apply the refined instructions
      const refinedResponse = await invokeLLM({
        model: "claude_sonnet_4_6",
        prompt: `Extract ONLY the "REFINED INSTRUCTIONS (READY TO USE)" section from this response and return it as clean, formatted text without any markdown headers or labels:

${response}`,
      });

      setGeneratedTemplate({
        ...currentTemplate,
        ai_prompt_instructions: refinedResponse.trim()
      });

    } catch {
      toast.error('Failed to refine instructions');
    }
    setIsProcessing(false);
  };

  const handleApply = () => {
    if (generatedTemplate) {
      onApplySuggestion(generatedTemplate);
      toast.success('Template applied! Review and save.');
    }
  };

  return (
    <div className="space-y-4">
      {conversation.length === 0 && (
        <div className="flex gap-2 flex-wrap">
          {mode === 'generate' && (
            <Button
              onClick={startGeneration}
              disabled={isProcessing}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 mr-2" />
              )}
              Generate with AI
            </Button>
          )}
          {mode === 'improve' && currentTemplate && (
            <Button
              onClick={improveCurrent}
              disabled={isProcessing}
              variant="outline"
              className="border-navy-300 text-navy-700"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Lightbulb className="w-4 h-4 mr-2" />
              )}
              Get AI Suggestions
            </Button>
          )}
          {mode === 'refine' && currentTemplate?.template_type === 'patient_specific' && (
            <Button
              onClick={refineInstructions}
              disabled={isProcessing}
              variant="outline"
              className="border-navy-300 text-navy-700"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Refine AI Instructions
            </Button>
          )}
        </div>
      )}

      {conversation.length > 0 && (
        <Card className="border-navy-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-navy-600" />
              AI Assistant
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {conversation.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-50 ml-8'
                      : 'bg-navy-50 mr-8'
                  }`}
                >
                  <div className="font-semibold mb-1 text-xs text-slate-600">
                    {msg.role === 'user' ? 'You' : 'AI Assistant'}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))}
            </div>

            {generatedTemplate && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <AlertDescription>
                  <div className="space-y-2 text-sm">
                    <p className="font-semibold text-green-900">Generated Template Preview:</p>
                    <div className="bg-white p-3 rounded border">
                      <p><strong>Phrase:</strong> {generatedTemplate.phrase}</p>
                      <p><strong>Category:</strong> {generatedTemplate.category}</p>
                      <p><strong>Type:</strong> {generatedTemplate.template_type}</p>
                      {generatedTemplate.expanded_text && (
                        <p className="mt-2 text-xs text-slate-600">{generatedTemplate.expanded_text}</p>
                      )}
                    </div>
                    <Button
                      onClick={handleApply}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 w-full"
                    >
                      Apply This Template
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {!generatedTemplate && !isProcessing && (
              <div className="flex gap-2">
                <Textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="Type your response..."
                  rows={2}
                  className="text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      continueConversation();
                    }
                  }}
                />
                <Button
                  onClick={continueConversation}
                  disabled={!userInput.trim() || isProcessing}
                  size="sm"
                >
                  Send
                </Button>
              </div>
            )}

            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                AI is thinking...
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}