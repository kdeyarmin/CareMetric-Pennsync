import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Type } from "lucide-react";
import { toast } from "sonner";

const FIELD_TYPES = [
  { value: "text", label: "Text Field" },
  { value: "signature", label: "Signature" },
  { value: "initials", label: "Initials" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" }
];

const PATIENT_FIELDS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "email",
  "phone",
  "address",
  "medical_record_number"
];

export default function PDFFieldMapper({ onFieldsChange, initialFields = [] }) {
  const [fields, setFields] = useState(initialFields);
  const [newField, setNewField] = useState({
    type: "text",
    label: "",
    fieldName: "",
    dataSource: "patient",
    dataField: "first_name"
  });

  const addField = () => {
    if (!newField.label || !newField.fieldName) {
      toast.error("Please fill in all field details");
      return;
    }

    const field = {
      id: Math.random().toString(36).substr(2, 9),
      ...newField
    };

    const updatedFields = [...fields, field];
    setFields(updatedFields);
    onFieldsChange(updatedFields);
    setNewField({
      type: "text",
      label: "",
      fieldName: "",
      dataSource: "patient",
      dataField: "first_name"
    });
    toast.success("Field added");
  };

  const removeField = (fieldId) => {
    const updatedFields = fields.filter(f => f.id !== fieldId);
    setFields(updatedFields);
    onFieldsChange(updatedFields);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Map PDF Fields</h3>
        <p className="text-sm text-slate-600">Define fields and link them to patient data</p>
      </div>

      {/* Add New Field */}
      <Card className="p-4">
        <div className="space-y-3">
          <div>
            <label htmlFor="mapper-field-type" className="block text-sm font-medium text-slate-700 mb-1">
              Field Type
            </label>
            <Select value={newField.type} onValueChange={(val) =>
              setNewField({ ...newField, type: val })
            }>
              <SelectTrigger id="mapper-field-type" className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map(ft => (
                  <SelectItem key={ft.value} value={ft.value}>
                    {ft.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="mapper-field-label" className="block text-sm font-medium text-slate-700 mb-1">
                Label
              </label>
              <Input
                id="mapper-field-label"
                placeholder="e.g., Patient Name"
                value={newField.label}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                className="text-sm"
              />
            </div>

            <div>
              <label htmlFor="mapper-field-name" className="block text-sm font-medium text-slate-700 mb-1">
                Field Name
              </label>
              <Input
                id="mapper-field-name"
                placeholder="e.g., patient_name"
                value={newField.fieldName}
                onChange={(e) => setNewField({ ...newField, fieldName: e.target.value })}
                className="text-sm"
              />
            </div>
          </div>

          {newField.type !== "signature" && newField.type !== "initials" && (
            <div>
              <label htmlFor="mapper-data-source" className="block text-sm font-medium text-slate-700 mb-1">
                Data Source
              </label>
              <Select value={newField.dataSource} onValueChange={(val) =>
                setNewField({ ...newField, dataSource: val })
              }>
                <SelectTrigger id="mapper-data-source" className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="patient">Patient Data</SelectItem>
                  <SelectItem value="manual">Manual Entry</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {newField.dataSource === "patient" && newField.type !== "signature" && (
            <div>
              <label htmlFor="mapper-patient-field" className="block text-sm font-medium text-slate-700 mb-1">
                Patient Field
              </label>
              <Select value={newField.dataField} onValueChange={(val) =>
                setNewField({ ...newField, dataField: val })
              }>
                <SelectTrigger id="mapper-patient-field" className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PATIENT_FIELDS.map(pf => (
                    <SelectItem key={pf} value={pf}>
                      {pf.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            onClick={addField}
            className="w-full text-sm"
          >
            <Plus className="w-3 h-3 mr-2" />
            Add Field
          </Button>
        </div>
      </Card>

      {/* Fields List */}
      {fields.length > 0 && (
        <Card className="p-4">
          <div className="space-y-2">
            {fields.map((field) => (
              <div
                key={field.id}
                className="flex items-start justify-between p-3 bg-slate-50 rounded-lg gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {field.label}
                      </p>
                      <p className="text-xs text-slate-500">
                        {FIELD_TYPES.find(ft => ft.value === field.type)?.label} 
                        {field.dataSource === "patient" && ` • ${field.dataField}`}
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => removeField(field.id)}
                  className="p-1 hover:bg-slate-200 rounded text-slate-600 flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}