import React, { useState, useRef } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";

const PLACEHOLDER_TYPES = [
  { key: "patient_name", label: "Patient Name", type: "text" },
  { key: "date", label: "Date", type: "date" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "phone" },
];

export default function VisualTemplateEditor({
  initialContent = "",
  onContentChange,
  onPlaceholdersChange,
  onSignatureFieldsChange,
  initialPlaceholders = [],
  initialSignatureFields = [],
}) {
  const [content, setContent] = useState(initialContent);
  const [placeholders, setPlaceholders] = useState(initialPlaceholders);
  const [signatureFields, setSignatureFields] = useState(initialSignatureFields);
  const [selectedPlaceholder, setSelectedPlaceholder] = useState(null);
  const [newPlaceholder, setNewPlaceholder] = useState({
    key: "",
    label: "",
    type: "text",
  });
  const [newSignatureField, setNewSignatureField] = useState({
    label: "Signature",
    required_role: "patient",
    date_field: true,
    optional: false,
  });
  const previewRef = useRef(null);

  const handleAddPlaceholder = () => {
    if (!newPlaceholder.key || !newPlaceholder.label) {
      toast.error("Enter placeholder key and label");
      return;
    }

    const placeholder = {
      key: newPlaceholder.key.toLowerCase(),
      label: newPlaceholder.label,
      type: newPlaceholder.type,
      required: true,
    };

    const updated = [...placeholders, placeholder];
    setPlaceholders(updated);
    onPlaceholdersChange?.(updated);

    setNewPlaceholder({ key: "", label: "", type: "text" });
    toast.success("Placeholder added");
  };

  const handleRemovePlaceholder = (idx) => {
    const updated = placeholders.filter((_, i) => i !== idx);
    setPlaceholders(updated);
    onPlaceholdersChange?.(updated);
  };

  const handleAddSignatureField = () => {
    if (!newSignatureField.label) {
      toast.error("Enter signature field label");
      return;
    }

    const field = {
      field_id: `sig_${Date.now()}`,
      label: newSignatureField.label,
      required_role: newSignatureField.required_role,
      date_field: newSignatureField.date_field,
      optional: newSignatureField.optional,
      position: { page: 1, x: 10, y: 90 },
    };

    const updated = [...signatureFields, field];
    setSignatureFields(updated);
    onSignatureFieldsChange?.(updated);

    setNewSignatureField({
      label: "Signature",
      required_role: "patient",
      date_field: true,
      optional: false,
    });
    toast.success("Signature field added");
  };

  const handleRemoveSignatureField = (idx) => {
    const updated = signatureFields.filter((_, i) => i !== idx);
    setSignatureFields(updated);
    onSignatureFieldsChange?.(updated);
  };

  const handleInsertPlaceholder = (placeholder) => {
    const quill = document.querySelector(".ql-editor");
    if (quill) {
      const selection = window.getSelection();
      const range = selection.getRangeAt(0);
      const span = document.createElement("span");
      span.className = "placeholder-field";
      span.textContent = `{{${placeholder.key}}}`;
      span.style.backgroundColor = "#e0e7ff";
      span.style.padding = "2px 4px";
      span.style.borderRadius = "3px";
      span.style.fontStyle = "italic";
      range.insertNode(span);
    }
  };

  const handleContentChange = (value) => {
    setContent(value);
    onContentChange?.(value);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left Panel - Controls */}
      <div className="lg:col-span-1 space-y-4 overflow-y-auto max-h-[80vh]">
        {/* Placeholders Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Placeholders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium">Quick Add</label>
              <div className="grid grid-cols-1 gap-1">
                {PLACEHOLDER_TYPES.map((p) => (
                  <Button
                    key={p.key}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const exists = placeholders.some((ph) => ph.key === p.key);
                      if (!exists) {
                        const updated = [...placeholders, p];
                        setPlaceholders(updated);
                        onPlaceholdersChange?.(updated);
                        toast.success(`${p.label} added`);
                      }
                    }}
                    className="text-xs justify-start"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" className="w-full" variant="outline">
                    <Plus className="w-3 h-3 mr-1" />
                    Custom Placeholder
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Add Custom Placeholder</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">Key</label>
                      <Input
                        placeholder="patient_age"
                        value={newPlaceholder.key}
                        onChange={(e) =>
                          setNewPlaceholder({
                            ...newPlaceholder,
                            key: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Label</label>
                      <Input
                        placeholder="Patient Age"
                        value={newPlaceholder.label}
                        onChange={(e) =>
                          setNewPlaceholder({
                            ...newPlaceholder,
                            label: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Type</label>
                      <Select
                        value={newPlaceholder.type}
                        onValueChange={(value) =>
                          setNewPlaceholder({
                            ...newPlaceholder,
                            type: value,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="phone">Phone</SelectItem>
                          <SelectItem value="select">Select</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={handleAddPlaceholder}
                      className="w-full"
                    >
                      Add Placeholder
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {placeholders.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-600">
                  Added ({placeholders.length})
                </p>
                {placeholders.map((ph, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-blue-50 rounded text-xs"
                  >
                    <div>
                      <p className="font-medium">{ph.label}</p>
                      <p className="text-gray-500">{`{{${ph.key}}}`}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemovePlaceholder(idx)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Signature Fields Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Signature Fields</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" className="w-full">
                  <Plus className="w-3 h-3 mr-1" />
                  Add Signature Field
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Add Signature Field</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">Label</label>
                    <Input
                      placeholder="Patient Signature"
                      value={newSignatureField.label}
                      onChange={(e) =>
                        setNewSignatureField({
                          ...newSignatureField,
                          label: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Required Role</label>
                    <Select
                      value={newSignatureField.required_role}
                      onValueChange={(value) =>
                        setNewSignatureField({
                          ...newSignatureField,
                          required_role: value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="patient">Patient</SelectItem>
                        <SelectItem value="provider">Provider</SelectItem>
                        <SelectItem value="caregiver">Caregiver</SelectItem>
                        <SelectItem value="witness">Witness</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="date-field"
                      checked={newSignatureField.date_field}
                      onChange={(e) =>
                        setNewSignatureField({
                          ...newSignatureField,
                          date_field: e.target.checked,
                        })
                      }
                    />
                    <label htmlFor="date-field" className="text-sm">
                      Include date field
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="optional"
                      checked={newSignatureField.optional}
                      onChange={(e) =>
                        setNewSignatureField({
                          ...newSignatureField,
                          optional: e.target.checked,
                        })
                      }
                    />
                    <label htmlFor="optional" className="text-sm">
                      Optional
                    </label>
                  </div>
                  <Button
                    onClick={handleAddSignatureField}
                    className="w-full"
                  >
                    Add Field
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {signatureFields.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-600">
                  Added ({signatureFields.length})
                </p>
                {signatureFields.map((field, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-green-50 rounded text-xs"
                  >
                    <div>
                      <p className="font-medium">{field.label}</p>
                      <Badge variant="outline" className="text-xs mt-1">
                        {field.required_role}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveSignatureField(idx)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right Panel - Rich Text Editor & Preview */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Document Content</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactQuill
              value={content}
              onChange={handleContentChange}
              modules={{
                toolbar: [
                  [{ header: [1, 2, 3, false] }],
                  ["bold", "italic", "underline", "strike"],
                  ["blockquote", "code-block"],
                  [{ list: "ordered" }, { list: "bullet" }],
                  [{ align: [] }],
                  ["link"],
                  ["clean"],
                ],
              }}
              className="h-64"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Document Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              ref={previewRef}
              className="w-full bg-white border rounded p-6 min-h-96 prose prose-sm max-w-none overflow-auto"
              dangerouslySetInnerHTML={{ __html: content }}
            />
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-gray-600">
                Placeholders in document:
              </p>
              <div className="flex flex-wrap gap-2">
                {placeholders.map((ph) => (
                  <Badge key={ph.key} variant="secondary" className="text-xs">
                    {`{{${ph.key}}}`}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}