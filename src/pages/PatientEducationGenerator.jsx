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
    educationLevel: 'general'
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

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

    try {
      const response = await base44.functions.invoke('generatePatientEducationMaterial', {
        patientId: formData.patientId || null,
        diagnosis: formData.diagnosis,
        topic: formData.topic,
        educationLevel: formData.educationLevel
      });

      setResult(response.data);
    } catch (err) {
      setError(err.message || 'Failed to generate education material');
    } finally {
      setLoading(false);
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
                <Label className="text-sm">Education Level</Label>
                <Select value={formData.educationLevel} onValueChange={(value) => setFormData({...formData, educationLevel: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
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

                <Button className="w-full bg-blue-600 hover:bg-blue-700">
                  Save & Send to Patient
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}