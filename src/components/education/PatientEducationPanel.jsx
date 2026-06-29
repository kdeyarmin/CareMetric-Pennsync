import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BookOpen,
  Sparkles,
  FileText,
  Pill,
  AlertCircle,
  Heart,
  Target,
  ChevronDown,
  ChevronUp,
  Download,
  Share2,
  RefreshCw
} from "lucide-react";
import { toast } from 'sonner';

export default function PatientEducationPanel({ patientId }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [materials, setMaterials] = useState(null);
  const [expandedMaterials, setExpandedMaterials] = useState([]);

  const generateMaterials = async () => {
    if (!patientId) return;

    setIsGenerating(true);
    try {
      const { data } = await base44.functions.invoke('generatePatientEducation', {
        patient_id: patientId
      });

      setMaterials(data);
      if (data.materials?.length > 0) {
        setExpandedMaterials([0]);
      }
    } catch (error) {
      console.error('Error generating education materials:', error);
      toast.error('Failed to generate education materials. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleExpanded = (index) => {
    setExpandedMaterials(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'medication': return Pill;
      case 'warning_signs': return AlertCircle;
      case 'self_care': return Heart;
      case 'care_plan': return Target;
      default: return FileText;
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'medication': return 'bg-navy-600';
      case 'warning_signs': return 'bg-red-600';
      case 'self_care': return 'bg-green-600';
      case 'care_plan': return 'bg-blue-600';
      default: return 'bg-slate-600';
    }
  };

  const escapeHtml = (str) => {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const handlePrintMaterial = (material) => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>${escapeHtml(material.title)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { color: #1e40af; margin-bottom: 20px; }
            h2 { color: #4b5563; margin-top: 30px; margin-bottom: 15px; }
            p { line-height: 1.6; color: #374151; margin-bottom: 15px; }
            ul { margin-left: 20px; }
            li { margin-bottom: 8px; color: #374151; }
            .warning { background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(material.title)}</h1>
          <p>${escapeHtml(material.content).split('\n\n').join('</p><p>')}</p>
          ${material.key_points?.length > 0 ? `
            <h2>Key Points</h2>
            <ul>${material.key_points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
          ` : ''}
          ${material.when_to_call?.length > 0 ? `
            <div class="warning">
              <h2>When to Call Your Healthcare Provider</h2>
              <ul>${material.when_to_call.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
            </div>
          ` : ''}
          ${material.additional_resources ? `
            <h2>Additional Resources</h2>
            <p>${escapeHtml(material.additional_resources)}</p>
          ` : ''}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  if (!materials) {
    return (
      <Card className="border-2 border-navy-300 bg-navy-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-navy-900">
            <BookOpen className="w-4 h-4" />
            Patient Education Materials
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-navy-800 mb-3">
            Generate personalized education materials based on diagnoses, medications, and care plans.
          </p>
          <Button
            onClick={generateMaterials}
            disabled={isGenerating}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700 w-full"
          >
            {isGenerating ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                Creating Materials...
              </>
            ) : (
              <>
                <BookOpen className="w-4 h-4 mr-2" />
                Generate Education Materials
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-300 bg-navy-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 text-navy-900">
            <BookOpen className="w-4 h-4" />
            Patient Education Materials
          </CardTitle>
          <Badge className="bg-navy-600 text-white">
            {materials.materials?.length || 0} topics
          </Badge>
        </div>
        {materials.summary && (
          <p className="text-xs text-navy-800 mt-2">{materials.summary}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {materials.materials?.map((material, index) => {
          const isExpanded = expandedMaterials.includes(index);
          const CategoryIcon = getCategoryIcon(material.category);
          const categoryColor = getCategoryColor(material.category);

          return (
            <Card key={index} className="bg-white border-l-4 border-navy-400">
              <CardContent className="p-4">
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => toggleExpanded(index)}
                >
                  <div className="flex items-start gap-2 flex-1">
                    <CategoryIcon className="w-5 h-5 text-navy-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`${categoryColor} text-white text-xs`}>
                          {(material.category || '').replace('_', ' ')}
                        </Badge>
                      </div>
                      <h4 className="font-semibold text-sm text-slate-900">{material.title}</h4>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="space-y-3 border-t border-slate-200 pt-3 mt-3">
                    <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {material.content}
                    </div>

                    {material.key_points?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                          <Target className="w-3 h-3" />
                          Key Points:
                        </p>
                        <ul className="space-y-1">
                          {material.key_points.map((point, idx) => (
                            <li key={idx} className="text-xs text-slate-600 flex items-start gap-2">
                              <span className="text-navy-600 font-bold">•</span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {material.when_to_call?.length > 0 && (
                      <Alert className="bg-red-50 border-red-300">
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <AlertDescription>
                          <p className="text-xs font-semibold text-red-800 mb-1">When to Call Your Healthcare Provider:</p>
                          <ul className="space-y-1">
                            {material.when_to_call.map((warning, idx) => (
                              <li key={idx} className="text-xs text-red-700">• {warning}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {material.additional_resources && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2">
                        <p className="text-xs text-blue-800">{material.additional_resources}</p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePrintMaterial(material);
                        }}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Print/Save
                      </Button>
                      <Button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await navigator.clipboard.writeText(`${material.title}\n\n${material.content}`);
                            toast.success('Content copied to clipboard!');
                          } catch {
                            toast.error("Couldn't copy — copy the content manually.");
                          }
                        }}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        <Share2 className="w-3 h-3 mr-1" />
                        Copy
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Button
          onClick={generateMaterials}
          variant="outline"
          size="sm"
          className="w-full mt-2"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Regenerate Materials
        </Button>
      </CardContent>
    </Card>
  );
}