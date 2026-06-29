import React, { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  Loader2,
  Search,
  Copy,
  Printer,
  CheckCircle2,
  Heart,
  Pill,
  Activity,
  Utensils,
  Shield,
  AlertTriangle
} from "lucide-react";
import { toast } from 'sonner';

export default function EducationMaterialGenerator({ patient, teachBackHistory = [], onMaterialGenerated }) {
  const [searchTopic, setSearchTopic] = useState("");
  const [category, setCategory] = useState("");
  const [readingLevel, setReadingLevel] = useState("simple");
  const [language, setLanguage] = useState("english");
  const [culturalBackground, setCulturalBackground] = useState("not_specified");
  const ai = useAICall();
  const [generatedContent, setGeneratedContent] = useState(null);
  const [copied, setCopied] = useState(false);
  const [learningProfile, setLearningProfile] = useState(null);

  // Analyze teach-back history to determine learning profile
  React.useEffect(() => {
    if (teachBackHistory.length > 0) {
      const levels = teachBackHistory.map(t => t.understandingLevel);
      const goodCount = levels.filter(l => l === 'good').length;
      const _fairCount = levels.filter(l => l === 'fair').length;
      const poorCount = levels.filter(l => l === 'poor').length;
      
      let recommendedLevel = 'simple';
      let learningStyle = 'visual';
      
      if (goodCount > levels.length * 0.7) {
        recommendedLevel = 'moderate';
      } else if (poorCount > levels.length * 0.3) {
        recommendedLevel = 'simple';
        learningStyle = 'repetitive';
      }
      
      setLearningProfile({
        recommendedLevel,
        learningStyle,
        successRate: Math.round((goodCount / levels.length) * 100),
        totalSessions: levels.length
      });
      
      setReadingLevel(recommendedLevel);
    }
  }, [teachBackHistory]);

  const categories = [
    { value: "disease_management", label: "Disease Management", icon: Heart },
    { value: "medications", label: "Medications", icon: Pill },
    { value: "vital_signs", label: "Vital Signs & Monitoring", icon: Activity },
    { value: "nutrition", label: "Nutrition & Diet", icon: Utensils },
    { value: "safety", label: "Safety & Fall Prevention", icon: Shield },
    { value: "wound_care", label: "Wound Care", icon: AlertTriangle },
    { value: "symptom_management", label: "Symptom Management", icon: Brain },
  ];

  const commonTopics = [
    "CHF - Daily Weight Monitoring",
    "Diabetes - Blood Sugar Management",
    "COPD - Breathing Techniques",
    "Hypertension - Blood Pressure Control",
    "Fall Prevention at Home",
    "Medication Safety",
    "Wound Care Instructions",
    "Pain Management",
    "Hospice Comfort Care",
    "Caregiver Self-Care"
  ];

  const culturalOptions = [
    { value: "not_specified", label: "Not specified" },
    { value: "hispanic_latino", label: "Hispanic/Latino" },
    { value: "african_american", label: "African American" },
    { value: "asian", label: "Asian" },
    { value: "native_american", label: "Native American" },
    { value: "middle_eastern", label: "Middle Eastern" },
    { value: "european", label: "European" },
    { value: "caribbean", label: "Caribbean" },
    { value: "south_asian", label: "South Asian" }
  ];

  const generateMaterial = async () => {
    const topic = searchTopic || (patient?.primary_diagnosis);
    if (!topic) {
      toast.error("Please enter a topic or select a patient with a diagnosis.");
      return;
    }

    try {
      // Build personalization context
      let personalizationContext = '';
      
      if (learningProfile) {
        personalizationContext += `
LEARNING PROFILE (from previous teach-back sessions):
- Understanding success rate: ${learningProfile.successRate}%
- Recommended complexity: ${learningProfile.recommendedLevel}
- Learning style: ${learningProfile.learningStyle}
- Total education sessions: ${learningProfile.totalSessions}
${learningProfile.successRate < 50 ? '- IMPORTANT: Patient has struggled with understanding. Use extra simple language, more repetition, and visual descriptions.' : ''}
${learningProfile.successRate > 80 ? '- Patient learns well. Can use slightly more detailed explanations.' : ''}
`;
      }

      if (culturalBackground && culturalBackground !== "not_specified") {
        personalizationContext += `
CULTURAL CONSIDERATIONS (${culturalBackground.replace(/_/g, ' ')}):
- Use culturally appropriate examples and analogies
- Consider dietary preferences and traditional practices when relevant
- Be sensitive to cultural health beliefs and practices
- Include family/community involvement where culturally appropriate
`;
      }

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are a patient education specialist creating PERSONALIZED, easy-to-understand health education materials for home health and hospice patients.

TOPIC: ${topic}
CATEGORY: ${category || 'General'}
READING LEVEL: ${readingLevel === 'simple' ? '5th grade reading level - very simple words, short sentences' : readingLevel === 'moderate' ? '8th grade reading level' : 'Standard adult reading level'}
LANGUAGE: ${language}
${patient ? `PATIENT CONTEXT: ${patient.first_name} ${patient.last_name}, Diagnosis: ${patient.primary_diagnosis}, Care Type: ${patient.care_type}` : ''}
${personalizationContext}

PERSONALIZATION REQUIREMENTS:
1. Tailor examples and analogies to be relatable to the patient's background
2. Adjust complexity based on their learning profile
3. If patient has low understanding scores, use more repetition, bullet points, and simple analogies
4. Include culturally appropriate food examples, family dynamics, and health practices
5. Use encouraging, supportive language

Create comprehensive patient education material that includes:
1. Simple explanation of the topic
2. Key points to remember (bullet points)
3. Warning signs to watch for
4. When to call the nurse/doctor
5. Self-care tips
6. Teach-back questions to verify understanding

IMPORTANT: Use plain, simple language. Avoid medical jargon. Use short sentences. Include visual descriptions where helpful.

Return JSON:
{
  "title": "Education material title",
  "topic": "The topic covered",
  "reading_level": "${readingLevel}",
  "introduction": "Simple 2-3 sentence introduction",
  "key_points": [
    {
      "point": "Key point text",
      "explanation": "Simple explanation"
    }
  ],
  "warning_signs": [
    {
      "sign": "Warning sign",
      "action": "What to do"
    }
  ],
  "when_to_call": [
    "Situation requiring nurse/doctor call"
  ],
  "self_care_tips": [
    {
      "tip": "Self-care tip",
      "how_to": "How to do it"
    }
  ],
  "teach_back_questions": [
    {
      "question": "Question to ask patient",
      "expected_answer": "What a correct answer should include"
    }
  ],
  "summary": "2-3 sentence summary of most important points",
  "printable_version": "A formatted text version suitable for printing"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            topic: { type: "string" },
            reading_level: { type: "string" },
            introduction: { type: "string" },
            key_points: { type: "array", items: { type: "object" } },
            warning_signs: { type: "array", items: { type: "object" } },
            when_to_call: { type: "array", items: { type: "string" } },
            self_care_tips: { type: "array", items: { type: "object" } },
            teach_back_questions: { type: "array", items: { type: "object" } },
            summary: { type: "string" },
            printable_version: { type: "string" }
          }
        }
      });

      setGeneratedContent(result);
      if (onMaterialGenerated) {
        onMaterialGenerated(result);
      }
    } catch (error) {
      console.error("Error generating material:", error);
      toast.error("Error generating material. Please try again.");
    }
  };

  const handleCopy = () => {
    if (generatedContent?.printable_version) {
      navigator.clipboard.writeText(generatedContent.printable_version);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = () => {
    if (generatedContent) {
      const escapeHtml = (str) => {
        if (str == null) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html>
          <head>
            <title>${escapeHtml(generatedContent.title)}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
              h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
              h2 { color: #1e40af; margin-top: 20px; }
              ul { margin: 10px 0; }
              li { margin: 8px 0; }
              .warning { background: #fef3c7; padding: 15px; border-radius: 8px; margin: 10px 0; }
              .call { background: #fee2e2; padding: 15px; border-radius: 8px; margin: 10px 0; }
              .tip { background: #d1fae5; padding: 10px; border-radius: 8px; margin: 8px 0; }
            </style>
          </head>
          <body>
            <h1>${escapeHtml(generatedContent.title)}</h1>
            <p>${escapeHtml(generatedContent.introduction)}</p>
            
            <h2>Key Points to Remember</h2>
            <ul>
              ${generatedContent.key_points?.map(kp => `<li><strong>${escapeHtml(kp.point)}</strong><br>${escapeHtml(kp.explanation)}</li>`).join('') || ''}
            </ul>
            
            <div class="warning">
              <h2>⚠️ Warning Signs</h2>
              <ul>
                ${generatedContent.warning_signs?.map(ws => `<li><strong>${escapeHtml(ws.sign)}</strong> - ${escapeHtml(ws.action)}</li>`).join('') || ''}
              </ul>
            </div>
            
            <div class="call">
              <h2>📞 Call Your Nurse or Doctor If:</h2>
              <ul>
                ${generatedContent.when_to_call?.map(item => `<li>${escapeHtml(item)}</li>`).join('') || ''}
              </ul>
            </div>
            
            <h2>Self-Care Tips</h2>
            ${generatedContent.self_care_tips?.map(tip => `<div class="tip"><strong>${escapeHtml(tip.tip)}</strong><br>${escapeHtml(tip.how_to)}</div>`).join('') || ''}
            
            <h2>Summary</h2>
            <p><strong>${escapeHtml(generatedContent.summary)}</strong></p>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <Card className="border-blue-200">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-600" />
          Generate Education Material
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Search & Options */}
        <div className="space-y-4">
          <div>
            <Label>Topic or Condition</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Enter topic (e.g., diabetes management, fall prevention)..."
                value={searchTopic}
                onChange={(e) => setSearchTopic(e.target.value)}
                className="flex-1"
              />
              <Button
                onClick={generateMaterial}
                disabled={ai.loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {ai.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Quick Topics */}
          <div>
            <Label className="text-xs text-slate-500">Quick Topics:</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {commonTopics.slice(0, 5).map((topic) => (
                <Badge
                  key={topic}
                  variant="outline"
                  className="cursor-pointer hover:bg-blue-50"
                  onClick={() => setSearchTopic(topic)}
                >
                  {topic}
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Reading Level</Label>
              <Select value={readingLevel} onValueChange={setReadingLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple (5th Grade)</SelectItem>
                  <SelectItem value="moderate">Moderate (8th Grade)</SelectItem>
                  <SelectItem value="standard">Standard Adult</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="english">English</SelectItem>
                  <SelectItem value="spanish">Spanish</SelectItem>
                  <SelectItem value="chinese">Chinese</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Cultural Background */}
          <div>
            <Label>Cultural Background (for personalized examples)</Label>
            <Select value={culturalBackground} onValueChange={setCulturalBackground}>
              <SelectTrigger>
                <SelectValue placeholder="Select cultural background..." />
              </SelectTrigger>
              <SelectContent>
                {culturalOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Learning Profile Display */}
          {learningProfile && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-sm font-semibold text-blue-900 mb-2">📊 Patient Learning Profile</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2 rounded">
                  <span className="text-slate-600">Success Rate:</span>
                  <span className={`ml-1 font-semibold ${learningProfile.successRate >= 70 ? 'text-green-600' : learningProfile.successRate >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {learningProfile.successRate}%
                  </span>
                </div>
                <div className="bg-white p-2 rounded">
                  <span className="text-slate-600">Sessions:</span>
                  <span className="ml-1 font-semibold">{learningProfile.totalSessions}</span>
                </div>
                <div className="bg-white p-2 rounded col-span-2">
                  <span className="text-slate-600">Recommended Level:</span>
                  <span className="ml-1 font-semibold capitalize">{learningProfile.recommendedLevel}</span>
                  <span className="text-slate-500 ml-1">(auto-selected)</span>
                </div>
              </div>
            </div>
          )}

          {patient && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSearchTopic(patient.primary_diagnosis || '')}
            >
              Use Patient's Diagnosis: {patient.primary_diagnosis || 'Not specified'}
            </Button>
          )}
        </div>

        {/* Generated Content */}
        {generatedContent && (
          <div className="space-y-4 border-t pt-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-900">{generatedContent.title}</h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <p className="text-slate-700">{generatedContent.introduction}</p>

            {/* Key Points */}
            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="font-semibold text-blue-900 mb-3">📌 Key Points to Remember</h4>
              <ul className="space-y-2">
                {generatedContent.key_points?.map((kp, idx) => (
                  <li key={idx} className="text-sm">
                    <strong>{kp.point}</strong>
                    <p className="text-slate-600">{kp.explanation}</p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Warning Signs */}
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <h4 className="font-semibold text-yellow-900 mb-3">⚠️ Warning Signs</h4>
              <ul className="space-y-2">
                {generatedContent.warning_signs?.map((ws, idx) => (
                  <li key={idx} className="text-sm">
                    <strong className="text-yellow-800">{ws.sign}</strong>
                    <span className="text-slate-700"> → {ws.action}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* When to Call */}
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <h4 className="font-semibold text-red-900 mb-3">📞 Call Your Nurse/Doctor If:</h4>
              <ul className="list-disc list-inside space-y-1">
                {generatedContent.when_to_call?.map((item, idx) => (
                  <li key={idx} className="text-sm text-red-800">{item}</li>
                ))}
              </ul>
            </div>

            {/* Self-Care Tips */}
            <div className="bg-green-50 p-4 rounded-lg">
              <h4 className="font-semibold text-green-900 mb-3">💚 Self-Care Tips</h4>
              <div className="space-y-2">
                {generatedContent.self_care_tips?.map((tip, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border border-green-200">
                    <strong className="text-sm">{tip.tip}</strong>
                    <p className="text-xs text-slate-600">{tip.how_to}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="bg-navy-50 p-4 rounded-lg border border-navy-200">
              <h4 className="font-semibold text-navy-900 mb-2">📝 Remember</h4>
              <p className="text-sm text-navy-800">{generatedContent.summary}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}