import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Database, FileText } from "lucide-react";

export default function TemplateFieldMapper({ mappings = [], signatureFields = [], onMappingsChange, onSignatureFieldsChange }) {
  const [newMapping, setNewMapping] = useState({
    pdf_field_name: '',
    data_source: 'patient',
    field_path: '',
    label: '',
    field_type: 'text',
    default_value: '',
    format: ''
  });

  const [newSigField, setNewSigField] = useState({
    field_name: '',
    label: '',
    role: 'Patient',
    required: true
  });

  const dataSourceFields = {
    patient: [
      'first_name', 'last_name', 'date_of_birth', 'address', 'phone', 'email',
      'medical_record_number', 'emergency_contact_name', 'emergency_contact_phone',
      'physician_name', 'physician_phone', 'primary_diagnosis', 'allergies'
    ],
    visit: [
      'visit_date', 'visit_type', 'vital_signs.temperature', 'vital_signs.blood_pressure_systolic',
      'vital_signs.blood_pressure_diastolic', 'vital_signs.heart_rate', 'nurse_notes'
    ],
    care_plan: [
      'problem', 'goal', 'interventions', 'target_date', 'status', 'baseline_measurement'
    ],
    medication: [
      'current_medications[0].name', 'current_medications[0].dosage', 
      'current_medications[0].frequency', 'current_medications[0].prescriber'
    ]
  };

  const addMapping = () => {
    if (!newMapping.pdf_field_name || !newMapping.field_path) return;
    
    onMappingsChange([...mappings, { ...newMapping }]);
    setNewMapping({
      pdf_field_name: '',
      data_source: 'patient',
      field_path: '',
      label: '',
      field_type: 'text',
      default_value: '',
      format: ''
    });
  };

  const removeMapping = (index) => {
    onMappingsChange(mappings.filter((_, i) => i !== index));
  };

  const addSignatureField = () => {
    if (!newSigField.field_name || !newSigField.label) return;
    
    onSignatureFieldsChange([...signatureFields, { ...newSigField }]);
    setNewSigField({
      field_name: '',
      label: '',
      role: 'Patient',
      required: true
    });
  };

  const removeSignatureField = (index) => {
    onSignatureFieldsChange(signatureFields.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {/* Field Mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4" />
            Data Field Mappings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing Mappings */}
          {mappings.length > 0 && (
            <div className="space-y-2">
              {mappings.map((mapping, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                  <div className="flex-1 grid grid-cols-4 gap-2 text-sm">
                    <div>
                      <span className="font-medium">{mapping.pdf_field_name}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">{mapping.data_source}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">{mapping.field_path}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">{mapping.field_type}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeMapping(index)}>
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add New Mapping */}
          <div className="grid grid-cols-6 gap-2">
            <Input
              placeholder="PDF Field"
              value={newMapping.pdf_field_name}
              onChange={(e) => setNewMapping({ ...newMapping, pdf_field_name: e.target.value })}
            />
            <Select
              value={newMapping.data_source}
              onValueChange={(value) => setNewMapping({ ...newMapping, data_source: value, field_path: '' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="patient">Patient</SelectItem>
                <SelectItem value="visit">Visit</SelectItem>
                <SelectItem value="care_plan">Care Plan</SelectItem>
                <SelectItem value="medication">Medication</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={newMapping.field_path}
              onValueChange={(value) => setNewMapping({ ...newMapping, field_path: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Field" />
              </SelectTrigger>
              <SelectContent>
                {(dataSourceFields[newMapping.data_source] || []).map((field) => (
                  <SelectItem key={field} value={field}>{field}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={newMapping.field_type}
              onValueChange={(value) => setNewMapping({ ...newMapping, field_type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Default"
              value={newMapping.default_value}
              onChange={(e) => setNewMapping({ ...newMapping, default_value: e.target.value })}
            />
            <Button onClick={addMapping} size="sm">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Signature Fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Signature Fields
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {signatureFields.length > 0 && (
            <div className="space-y-2">
              {signatureFields.map((field, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                  <div className="flex-1 text-sm">
                    <span className="font-medium">{field.label}</span>
                    <span className="text-slate-500 ml-2">({field.role})</span>
                    {field.required && <span className="text-red-600 ml-2">*</span>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeSignatureField(index)}>
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-5 gap-2">
            <Input
              placeholder="field_name"
              value={newSigField.field_name}
              onChange={(e) => setNewSigField({ ...newSigField, field_name: e.target.value })}
            />
            <Input
              placeholder="Label"
              value={newSigField.label}
              onChange={(e) => setNewSigField({ ...newSigField, label: e.target.value })}
            />
            <Input
              placeholder="Role"
              value={newSigField.role}
              onChange={(e) => setNewSigField({ ...newSigField, role: e.target.value })}
            />
            <Select
              value={newSigField.required ? "true" : "false"}
              onValueChange={(value) => setNewSigField({ ...newSigField, required: value === "true" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Required</SelectItem>
                <SelectItem value="false">Optional</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={addSignatureField} size="sm">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}