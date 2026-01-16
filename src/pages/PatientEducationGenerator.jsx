import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, BookOpen, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export default function PatientEducationGenerator() {
  const [formData, setFormData] = useState({
    patientId: '',
    diagnosis: '',
    topic: '',
    educationLevel: 'basic',
    language: 'English',
    treatmentPlan: ''
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 100),
    initialData: []
  });

  const handleGenerate = async () => {
    if (!formData.diagnosis || !formData.topic) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError(null);
    setSaved(false);

    try {
      const response = await base44.functions.invoke('generatePatientEducationMaterial', {
        patientId: formData.patientId || null,
        diagnosis: formData.diagnosis,
        topic: formData.topic,
        educationLevel: formData.educationLevel,
        language: formData.language,
        treatmentPlan: formData.treatmentPlan
      });

      setResult(response.data);
    } catch (err) {
      setError(err.message || 'Failed to generate education material');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    
    try {
      await base44.entities.PatientEducationMaterial.create({
        title: `${formData.topic} - ${formData.diagnosis}`,
        description: result.content?.overview || '',
        category: formData.diagnosis,
        content_type: 'text',
        content_text: JSON.stringify(result.content),
        reading_level: formData.educationLevel,
        language: formData.language,
        source: 'ai_generated',
        tags: [formData.diagnosis, formData.topic, formData.language],
        is_active: true
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Failed to save education material');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen className="w-8 h-8 text-blue-600" />
          Patient Education Generator
        </h1>
        <p className="text-gray-600 mt-2">Create personalized education materials powered by AI</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Generate Material</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm">Select Patient (Optional)</Label>
                <Select value={formData.patientId} onValueChange={(value) => setFormData({...formData, patientId: value})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose patient" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>General Material</SelectItem>
                    {patients.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-semibold">Diagnosis *</Label>
                <Input
                  placeholder="e.g., Diabetes, COPD"
                  value={formData.diagnosis}
                  onChange={(e) => setFormData({...formData, diagnosis: e.target.value})}
                />
              </div>

              <div>
                <Label className="text-sm font-semibold">Topic *</Label>
                <Input
                  placeholder="e.g., Medication Management"
                  value={formData.topic}
                  onChange={(e) => setFormData({...formData, topic: e.target.value})}
                />
              </div>

              <div>
                <Label className="text-sm">Reading Level</Label>
                <Select value={formData.educationLevel} onValueChange={(value) => setFormData({...formData, educationLevel: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic (Elementary)</SelectItem>
                    <SelectItem value="intermediate">Intermediate (High School)</SelectItem>
                    <SelectItem value="advanced">Advanced (College)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm">Language</Label>
                <Select value={formData.language} onValueChange={(value) => setFormData({...formData, language: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="Spanish">Spanish</SelectItem>
                    <SelectItem value="French">French</SelectItem>
                    <SelectItem value="Mandarin">Mandarin Chinese</SelectItem>
                    <SelectItem value="Vietnamese">Vietnamese</SelectItem>
                    <SelectItem value="Tagalog">Tagalog</SelectItem>
                    <SelectItem value="Korean">Korean</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm">Treatment Plan (Optional)</Label>
                <Textarea
                  placeholder="Describe the patient's treatment plan for more personalized material"
                  value={formData.treatmentPlan}
                  onChange={(e) => setFormData({...formData, treatmentPlan: e.target.value})}
                  className="h-20"
                />
              </div>

              <Button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Material'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="lg:col-span-2">
          {error && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6 flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <p className="text-red-800">{error}</p>
              </CardContent>
            </Card>
          )}

          {result?.content && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Generated Material</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.content.overview && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Overview</h3>
                    <p className="text-gray-700">{result.content.overview}</p>
                  </div>
                )}

                {result.content.key_points && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Key Points</h3>
                    <ul className="space-y-1">
                      {result.content.key_points.map((point, i) => (
                        <li key={i} className="text-gray-700 flex gap-2">
                          <span className="text-blue-600">•</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.content.daily_tips && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Daily Tips</h3>
                    <ul className="space-y-1">
                      {result.content.daily_tips.map((tip, i) => (
                        <li key={i} className="text-gray-700 flex gap-2">
                          <span className="text-green-600">✓</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.content.warning_signs && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <h3 className="font-semibold text-yellow-900 mb-2">Warning Signs</h3>
                    <ul className="space-y-1">
                      {result.content.warning_signs.map((sign, i) => (
                        <li key={i} className="text-yellow-800 flex gap-2">
                          <span>⚠</span>
                          {sign}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2">
                  {saved && (
                    <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-800">
                      ✓ Material saved successfully
                    </div>
                  )}
                  <Button 
                    onClick={handleSave}
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    Save to Library
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}