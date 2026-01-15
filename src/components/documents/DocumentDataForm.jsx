import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, ArrowLeft, Check } from 'lucide-react';
import { Alert } from '@/components/ui/alert';

export default function DocumentDataForm({ template, patients, onGenerate, onBack, generating }) {
  const [selectedPatient, setSelectedPatient] = useState('');
  const [customText, setCustomText] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setDocumentName(`${template.template_name} - ${new Date().toLocaleDateString()}`);
  }, [template]);

  const handleFieldChange = (fieldName, value) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    if (errors[fieldName]) {
      setErrors(prev => ({ ...prev, [fieldName]: null }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!selectedPatient) newErrors.patient = 'Patient selection is required';
    if (!documentName.trim()) newErrors.documentName = 'Document name is required';

    (template.required_fields || []).forEach(field => {
      if (!formData[field]?.trim()) {
        newErrors[field] = `${field} is required`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validateForm()) {
      const patient = patients.find(p => p.id === selectedPatient);
      onGenerate({
        template_id: template.id,
        patient_id: selectedPatient,
        document_name: documentName,
        custom_text: customText,
        generation_data: {
          ...formData,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          patient_email: patient.email,
          date: new Date().toLocaleDateString(),
          provider_name: 'Healthcare Provider'
        }
      });
    }
  };

  const patient = patients.find(p => p.id === selectedPatient);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {template.template_name} - Document Details
        </h2>
      </div>

      <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
        <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <div className="text-sm text-blue-800 dark:text-blue-200 ml-2">
          <strong>HIPAA Compliance:</strong> This document is encrypted and audit-logged. Only share with authorized patients.
        </div>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Document Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="documentName">Document Name *</Label>
            <Input
              id="documentName"
              value={documentName}
              onChange={(e) => handleFieldChange('documentName', e.target.value)}
              placeholder="e.g., Patient Education - John Doe"
              className={errors.documentName ? 'border-red-500' : ''}
            />
            {errors.documentName && <p className="text-xs text-red-600 mt-1">{errors.documentName}</p>}
          </div>

          <div>
            <Label htmlFor="patient">Select Patient *</Label>
            <Select value={selectedPatient} onValueChange={setSelectedPatient}>
              <SelectTrigger className={errors.patient ? 'border-red-500' : ''}>
                <SelectValue placeholder="Choose a patient..." />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} {p.date_of_birth && `(DOB: ${p.date_of_birth})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.patient && <p className="text-xs text-red-600 mt-1">{errors.patient}</p>}
          </div>
        </CardContent>
      </Card>

      {template.required_fields && template.required_fields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Required Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {template.required_fields.map((field) => (
              <div key={field}>
                <Label htmlFor={field}>{field} *</Label>
                {field.toLowerCase().includes('description') || field.toLowerCase().includes('notes') ? (
                  <Textarea
                    id={field}
                    value={formData[field] || ''}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    placeholder={`Enter ${field.toLowerCase()}`}
                    rows={3}
                    className={errors[field] ? 'border-red-500' : ''}
                  />
                ) : (
                  <Input
                    id={field}
                    value={formData[field] || ''}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    placeholder={`Enter ${field.toLowerCase()}`}
                    className={errors[field] ? 'border-red-500' : ''}
                  />
                )}
                {errors[field] && <p className="text-xs text-red-600 mt-1">{errors[field]}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {template.optional_fields && template.optional_fields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Optional Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {template.optional_fields.map((field) => (
              <div key={field}>
                <Label htmlFor={field}>{field}</Label>
                {field.toLowerCase().includes('description') || field.toLowerCase().includes('notes') ? (
                  <Textarea
                    id={field}
                    value={formData[field] || ''}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    placeholder={`Enter ${field.toLowerCase()}`}
                    rows={3}
                  />
                ) : (
                  <Input
                    id={field}
                    value={formData[field] || ''}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    placeholder={`Enter ${field.toLowerCase()}`}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Additional Instructions (Optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="customText">Add custom text or instructions</Label>
          <Textarea
            id="customText"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="Add any additional custom text or instructions..."
            rows={4}
          />
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={generating}
          className="bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700 text-slate-900 dark:text-white flex-1"
        >
          {generating ? 'Generating...' : (
            <>
              <Check className="w-4 h-4 mr-2" />
              Generate Document
            </>
          )}
        </Button>
      </div>
    </div>
  );
}