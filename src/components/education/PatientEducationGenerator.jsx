import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { Loader2, BookOpen, Download, Copy, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function PatientEducationGenerator({ onMaterialGenerated, patientAge }) {
  const [topicType, setTopicType] = useState('condition');
  const [topicName, setTopicName] = useState('');
  const [readingLevel, setReadingLevel] = useState('intermediate');
  const [format, setFormat] = useState('comprehensive');
  const [loading, setLoading] = useState(false);
  const [material, setMaterial] = useState(null);

  const generateMaterial = async () => {
    if (!topicName.trim()) {
      toast.error('Please enter a topic name');
      return;
    }

    setLoading(true);
    try {
      const response = await base44.functions.invoke('generatePatientEducationMaterial', {
        topic_type: topicType,
        topic_name: topicName,
        patient_age: patientAge,
        reading_level: readingLevel,
        format: format
      });

      if (response.data?.material) {
        setMaterial(response.data.material);
        onMaterialGenerated?.(response.data.material);
        toast.success('Educational material generated!');
      }
    } catch (error) {
      console.error('Error generating material:', error);
      toast.error('Failed to generate material');
    } finally {
      setLoading(false);
    }
  };

  const downloadAsPDF = () => {
    if (!material) return;
    
    const content = `${material.title}\n\n${material.content}`;
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', `${material.title.toLowerCase().replace(/\s+/g, '-')}.txt`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success('Downloaded!');
  };

  const copyToClipboard = () => {
    if (!material) return;
    const text = `${material.title}\n\n${material.content}`;
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600" />
            AI Patient Education Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!material ? (
            <>
              {/* Topic Type */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-2">Topic Type *</label>
                <Select value={topicType} onValueChange={setTopicType}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="condition">Medical Condition</SelectItem>
                    <SelectItem value="procedure">Procedure/Surgery</SelectItem>
                    <SelectItem value="medication">Medication</SelectItem>
                    <SelectItem value="treatment">Treatment Plan</SelectItem>
                    <SelectItem value="lifestyle">Lifestyle/Self-Care</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Topic Name */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-2">
                  {topicType === 'condition' && 'Condition Name'}
                  {topicType === 'procedure' && 'Procedure/Surgery Name'}
                  {topicType === 'medication' && 'Medication Name'}
                  {topicType === 'treatment' && 'Treatment Name'}
                  {topicType === 'lifestyle' && 'Lifestyle Topic'} *
                </label>
                <Input
                  placeholder={
                    topicType === 'condition' ? 'e.g., Diabetes Type 2' :
                    topicType === 'procedure' ? 'e.g., Knee Replacement' :
                    topicType === 'medication' ? 'e.g., Metformin' :
                    'Enter topic name...'
                  }
                  value={topicName}
                  onChange={(e) => setTopicName(e.target.value)}
                  className="h-10"
                />
              </div>

              {/* Reading Level */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-2">Reading Level</label>
                <Select value={readingLevel} onValueChange={setReadingLevel}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple (5th grade level)</SelectItem>
                    <SelectItem value="intermediate">Intermediate (8th-9th grade)</SelectItem>
                    <SelectItem value="advanced">Advanced (College level)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Format */}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-2">Format</label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comprehensive">Comprehensive Guide</SelectItem>
                    <SelectItem value="handout">One-Page Handout</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Generate Button */}
              <Button
                onClick={generateMaterial}
                disabled={loading || !topicName.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <BookOpen className="w-4 h-4 mr-2" />
                    Generate Educational Material
                  </>
                )}
              </Button>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Material Preview */}
              <div className="bg-white rounded-lg border border-blue-200 p-4 space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4">{material.title}</h3>
                  <div className="prose prose-sm max-w-none text-sm text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {material.content}
                  </div>
                </div>

                {/* Key Points */}
                {material.key_points?.length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Key Points
                    </h4>
                    <ul className="space-y-1">
                      {material.key_points.map((point, idx) => (
                        <li key={idx} className="text-xs text-gray-700 flex gap-2">
                          <span className="text-green-600 flex-shrink-0">•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warning Signs */}
                {material.warning_signs?.length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      When to Contact Doctor
                    </h4>
                    <ul className="space-y-1">
                      {material.warning_signs.map((sign, idx) => (
                        <li key={idx} className="text-xs text-gray-700 flex gap-2">
                          <span className="text-red-600 flex-shrink-0">⚠</span>
                          <span>{sign}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action Items */}
                {material.action_items?.length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="font-semibold text-sm text-gray-900 mb-2">Recommended Actions</h4>
                    <ul className="space-y-1">
                      {material.action_items.map((item, idx) => (
                        <li key={idx} className="text-xs text-gray-700 flex gap-2">
                          <span className="text-blue-600 flex-shrink-0">✓</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  onClick={copyToClipboard}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
                <Button
                  onClick={downloadAsPDF}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <Download className="w-3 h-3 mr-1" />
                  Download
                </Button>
                <Button
                  onClick={() => {
                    setMaterial(null);
                    setTopicName('');
                  }}
                  size="sm"
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  Create Another
                </Button>
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}