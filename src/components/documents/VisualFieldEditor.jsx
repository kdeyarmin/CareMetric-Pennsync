import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, Settings } from "lucide-react";
import { toast } from "sonner";
import FieldConfigPanel from "./FieldConfigPanel";

export default function VisualFieldEditor({ pdfUrl, onFieldsChange, initialFields = [] }) {
  const [fields, setFields] = useState(initialFields);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    setFields(initialFields);
  }, [initialFields]);

  const updateFields = (nextFields) => {
    setFields(nextFields);
    onFieldsChange(nextFields);
  };

  const addField = (newField) => {
    const field = {
      id: Math.random().toString(36).slice(2, 11),
      ...newField,
      position: newField.position || { x: 50, y: 50 },
      size: newField.size || { width: 200, height: 30 },
    };

    const updated = [...fields, field];
    updateFields(updated);
    setShowAddPanel(false);
    toast.success("Field added - drag to position");
  };

  const updateField = (fieldId, updates) => {
    updateFields(fields.map((field) => (field.id === fieldId ? { ...field, ...updates } : field)));
  };

  const removeField = (fieldId) => {
    updateFields(fields.filter((field) => field.id !== fieldId));
    setSelectedFieldId(null);
  };

  const handleDragStart = (event, fieldId) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("fieldId", fieldId);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event, fieldId) => {
    event.preventDefault();
    if (!containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, event.clientX - rect.left - 100);
    const y = Math.max(0, event.clientY - rect.top - 15);

    updateField(fieldId, {
      position: { x: Math.round(x), y: Math.round(y) },
    });
  };

  const getFieldTypeColor = (type) => {
    const colorMap = {
      text: "bg-blue-100",
      date: "bg-emerald-100",
      number: "bg-orange-100",
      select: "bg-indigo-100",
      checkbox: "bg-yellow-100",
      signature: "bg-navy-100",
    };

    return colorMap[type] || "bg-slate-100";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Visual Field Editor</h3>
          <p className="text-sm text-slate-600">Add fields, then drag them over the PDF where signatures and carried-forward patient data should appear.</p>
        </div>
        <Button onClick={() => setShowAddPanel(!showAddPanel)} size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Add Field
        </Button>
      </div>

      {showAddPanel && (
        <FieldConfigPanel onAdd={addField} onCancel={() => setShowAddPanel(false)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div
            ref={containerRef}
            className="relative w-full rounded-lg border-2 border-slate-300 overflow-hidden bg-white min-h-[720px]"
            onDragOver={handleDragOver}
          >
            {pdfUrl ? (
              <>
                <iframe
                  src={pdfUrl}
                  title="PDF template preview"
                  className="absolute inset-0 h-full w-full pointer-events-none bg-white"
                />
                <div className="absolute inset-0 bg-white/10" />
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500 bg-slate-50">
                Upload a PDF to place fields.
              </div>
            )}

            <div className="absolute inset-0">
              {fields.map((field) => (
                <div
                  key={field.id}
                  draggable
                  onDragStart={(event) => handleDragStart(event, field.id)}
                  onDrop={(event) => handleDrop(event, field.id)}
                  onClick={() => setSelectedFieldId(field.id)}
                  className={`absolute bg-white/95 border-2 rounded cursor-move transition-all shadow-sm ${
                    selectedFieldId === field.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-400 hover:border-slate-600'
                  } ${getFieldTypeColor(field.field_type)}`}
                  style={{
                    left: `${field.position?.x || 50}px`,
                    top: `${field.position?.y || 50}px`,
                    width: `${field.size?.width || 200}px`,
                    height: `${field.size?.height || 30}px`,
                    minWidth: "100px",
                    minHeight: "28px",
                  }}
                >
                  <div className="flex items-center justify-between p-1 h-full gap-2">
                    <span className="text-xs font-medium text-slate-800 truncate px-1">{field.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 bg-white/80 px-1 rounded">{field.field_type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-semibold text-slate-900">Fields ({fields.length})</h4>
          <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
            {fields.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No fields added yet</p>
            ) : (
              fields.map((field) => (
                <Card
                  key={field.id}
                  className={`p-3 cursor-pointer transition-all ${selectedFieldId === field.id ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}
                  onClick={() => setSelectedFieldId(field.id)}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{field.label}</p>
                        <p className="text-xs text-slate-500">{field.field_type}</p>
                      </div>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          removeField(field.id);
                        }}
                        className="p-1 hover:bg-red-100 rounded text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-600">Position: {field.position?.x || 0}, {field.position?.y || 0}</p>
                    {field.data_source && (
                      <p className="text-xs text-slate-600 bg-slate-50 p-1 rounded">
                        Source: {field.data_source}{field.field_path ? ` → ${field.field_path}` : ''}
                      </p>
                    )}
                    {field.default_value && (
                      <p className="text-xs text-slate-600 bg-slate-50 p-1 rounded">Default: {field.default_value}</p>
                    )}
                    {field.conditional && (
                      <p className="text-xs text-navy-600 bg-navy-50 p-1 rounded">Conditional visibility</p>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>

          {selectedFieldId && (
            <div className="pt-2 border-t">
              <p className="text-xs font-semibold text-slate-700 mb-2">Selected field</p>
              <Button size="sm" variant="outline" className="w-full text-xs">
                <Settings className="w-3 h-3 mr-2" />
                Drag on canvas to reposition
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
