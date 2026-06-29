import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select/Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "signature", label: "Signature" }
];

const DATA_SOURCES = [
  { value: "patient", label: "Patient Data" },
  { value: "visit", label: "Visit Data" },
  { value: "care_plan", label: "Care Plan" },
  { value: "custom", label: "Custom Field" }
];

const PATIENT_FIELDS = [
  "first_name", "last_name", "date_of_birth", "email", "phone", 
  "address", "medical_record_number", "payor"
];

export default function FieldConfigPanel({ onAdd, onCancel, initialData = null }) {
  const [formData, setFormData] = useState(initialData || {
    label: "",
    field_name: "",
    field_type: "text",
    data_source: "custom",
    field_path: "",
    default_value: "",
    placeholder: "",
    required: false,
    select_options: [],
    conditional: null
  });

  const [newOption, setNewOption] = useState("");
  const [showConditional, setShowConditional] = useState(false);

  const handleSubmit = () => {
    if (!formData.label.trim() || !formData.field_name.trim()) {
      toast.error("Label and field name are required");
      return;
    }
    onAdd(formData);
  };

  const addSelectOption = () => {
    if (!newOption.trim()) return;
    const updated = [...(formData.select_options || []), newOption];
    setFormData({ ...formData, select_options: updated });
    setNewOption("");
  };

  const removeOption = (index) => {
    const updated = formData.select_options.filter((_, i) => i !== index);
    setFormData({ ...formData, select_options: updated });
  };

  return (
    <Card className="p-4 space-y-4">
      <h4 className="font-semibold text-slate-900">Configure Field</h4>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="field-label" className="block text-xs font-medium text-slate-700 mb-1">Label</label>
          <Input
            id="field-label"
            placeholder="e.g., Patient Name"
            value={formData.label}
            onChange={(e) => setFormData({ ...formData, label: e.target.value })}
            className="text-sm"
          />
        </div>
        <div>
          <label htmlFor="field-name" className="block text-xs font-medium text-slate-700 mb-1">Field Name</label>
          <Input
            id="field-name"
            placeholder="e.g., patient_name"
            value={formData.field_name}
            onChange={(e) => setFormData({ ...formData, field_name: e.target.value })}
            className="text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="field-type" className="block text-xs font-medium text-slate-700 mb-1">Field Type</label>
          <Select value={formData.field_type} onValueChange={(val) =>
            setFormData({ ...formData, field_type: val, select_options: [] })
          }>
            <SelectTrigger id="field-type" className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map(ft => (
                <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="field-data-source" className="block text-xs font-medium text-slate-700 mb-1">Data Source</label>
          <Select value={formData.data_source} onValueChange={(val) =>
            setFormData({ ...formData, data_source: val, field_path: "" })
          }>
            <SelectTrigger id="field-data-source" className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATA_SOURCES.map(ds => (
                <SelectItem key={ds.value} value={ds.value}>{ds.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {formData.data_source === "patient" && formData.field_type !== "signature" && (
        <div>
          <label htmlFor="field-patient-field" className="block text-xs font-medium text-slate-700 mb-1">Patient Field</label>
          <Select value={formData.field_path} onValueChange={(val) =>
            setFormData({ ...formData, field_path: val })
          }>
            <SelectTrigger id="field-patient-field" className="text-sm">
              <SelectValue placeholder="Select field..." />
            </SelectTrigger>
            <SelectContent>
              {PATIENT_FIELDS.map(pf => (
                <SelectItem key={pf} value={pf}>{pf.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {formData.field_type !== "signature" && (
        <>
          <div>
            <label htmlFor="field-placeholder" className="block text-xs font-medium text-slate-700 mb-1">Placeholder</label>
            <Input
              id="field-placeholder"
              placeholder="Hint text..."
              value={formData.placeholder}
              onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
              className="text-sm"
            />
          </div>

          <div>
            <label htmlFor="field-default-value" className="block text-xs font-medium text-slate-700 mb-1">Default Value</label>
            <Input
              id="field-default-value"
              placeholder="Default value..."
              value={formData.default_value}
              onChange={(e) => setFormData({ ...formData, default_value: e.target.value })}
              className="text-sm"
            />
          </div>
        </>
      )}

      {formData.field_type === "select" && (
        <div className="space-y-2">
          <label htmlFor="field-option-input" className="block text-xs font-medium text-slate-700">Options</label>
          <div className="flex gap-2">
            <Input
              id="field-option-input"
              placeholder="Add option..."
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && addSelectOption()}
              className="text-sm"
            />
            <Button size="sm" onClick={addSelectOption} variant="outline">Add</Button>
          </div>
          {formData.select_options?.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {formData.select_options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded text-sm">
                  {opt}
                  <button onClick={() => removeOption(i)} className="text-red-500 hover:text-red-700">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="field-required"
          checked={formData.required}
          onCheckedChange={(checked) => setFormData({ ...formData, required: checked })}
        />
        <label htmlFor="field-required" className="text-sm font-medium text-slate-700">Required field</label>
      </div>

      {/* Conditional Visibility */}
      <button
        onClick={() => setShowConditional(!showConditional)}
        className="flex items-center gap-2 text-sm font-medium text-navy-600 hover:text-navy-700 w-full justify-between"
      >
        Conditional Visibility
        <ChevronDown className="w-4 h-4" style={{ transform: showConditional ? "rotate(180deg)" : "" }} />
      </button>

      {showConditional && (
        <div className="p-3 bg-navy-50 rounded-lg space-y-2 text-sm">
          <div>
            <label htmlFor="field-conditional-name" className="block text-xs font-medium text-slate-700 mb-1">Show if field equals:</label>
            <Input id="field-conditional-name" placeholder="Field name" className="text-xs" />
          </div>
          <div>
            <label htmlFor="field-conditional-value" className="block text-xs font-medium text-slate-700 mb-1">Value:</label>
            <Input id="field-conditional-value" placeholder="Value" className="text-xs" />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onCancel} className="flex-1 text-sm">Cancel</Button>
        <Button onClick={handleSubmit} className="flex-1 text-sm">Add Field</Button>
      </div>
    </Card>
  );
}