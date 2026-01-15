import React, { useState, useRef } from 'react';
import ReactQuill from 'react-quill';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Eye } from 'lucide-react';
import PlaceholderHelper from './PlaceholderHelper';
import TemplateFieldConfig from './TemplateFieldConfig';
import TemplatePreview from './TemplatePreview';
import 'react-quill/dist/quill.snow.css';

export default function TemplateBuilder({ initialTemplate, onSave, saving }) {
  const [name, setName] = useState(initialTemplate?.template_name || '');
  const [type, setType] = useState(initialTemplate?.template_type || 'custom');
  const [category, setCategory] = useState(initialTemplate?.category || '');
  const [description, setDescription] = useState(initialTemplate?.description || '');
  const [content, setContent] = useState(initialTemplate?.template_content || '');
  const [requiredFields, setRequiredFields] = useState(initialTemplate?.required_fields || []);
  const [optionalFields, setOptionalFields] = useState(initialTemplate?.optional_fields || []);
  const [newField, setNewField] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [errors, setErrors] = useState({});
  const quillRef = useRef(null);

  const validateTemplate = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'Template name is required';
    if (!type) newErrors.type = 'Template type is required';
    if (!content.trim() || content === '<p><br></p>') newErrors.content = 'Template content cannot be empty';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddField = (fieldType) => {
    if (newField.trim()) {
      if (fieldType === 'required') {
        setRequiredFields([...requiredFields, newField]);
      } else {
        setOptionalFields([...optionalFields, newField]);
      }
      setNewField('');
    }
  };

  const handleRemoveField = (field, fieldType) => {
    if (fieldType === 'required') {
      setRequiredFields(requiredFields.filter(f => f !== field));
    } else {
      setOptionalFields(optionalFields.filter(f => f !== field));
    }
  };

  const handleInsertPlaceholder = (placeholder) => {
    const editor = quillRef.current?.getEditor();
    if (editor) {
      const cursorPos = editor.getSelection()?.index || editor.getLength();
      editor.insertText(cursorPos, placeholder);
      editor.setSelection(cursorPos + placeholder.length);
    }
  };

  const handleSave = () => {
    if (validateTemplate()) {
      onSave({
        template_name: name,
        template_type: type,
        category: category || 'Custom',
        description,
        template_content: content,
        required_fields: requiredFields,
        optional_fields: optionalFields
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Template Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Template Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Custom Patient Education"
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="type">Document Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className={errors.type ? 'border-red-500' : ''}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="patient_education">Patient Education</SelectItem>
                  <SelectItem value="discharge_instructions">Discharge Instructions</SelectItem>
                  <SelectItem value="referral_letter">Referral Letter</SelectItem>
                  <SelectItem value="care_plan_summary">Care Plan Summary</SelectItem>
                  <SelectItem value="clinical_summary">Clinical Summary</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {errors.type && <p className="text-xs text-red-600 mt-1">{errors.type}</p>}
            </div>

            <div>
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Therapy, Nursing"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template"
            />
          </div>
        </CardContent>
      </Card>

      {/* Rich Text Editor */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Template Content</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="w-4 h-4 mr-2" />
            {showPreview ? 'Hide' : 'Show'} Preview
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Insert Placeholders:</Label>
            <PlaceholderHelper onInsert={handleInsertPlaceholder} />
          </div>

          <div>
            <Label>Content *</Label>
            <div className={`border rounded overflow-hidden ${errors.content ? 'border-red-500' : ''}`}>
              <ReactQuill
                ref={quillRef}
                value={content}
                onChange={setContent}
                modules={{
                  toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'align': [] }],
                    ['blockquote'],
                    ['clean']
                  ]
                }}
                style={{ height: '300px' }}
                placeholder="Create your template here. Use {{placeholder_name}} for patient data..."
              />
            </div>
            {errors.content && <p className="text-xs text-red-600 mt-1">{errors.content}</p>}
          </div>

          {showPreview && <TemplatePreview content={content} />}
        </CardContent>
      </Card>

      {/* Field Configuration */}
      <TemplateFieldConfig
        requiredFields={requiredFields}
        optionalFields={optionalFields}
        onAddRequired={() => handleAddField('required')}
        onAddOptional={() => handleAddField('optional')}
        onRemoveField={handleRemoveField}
        newField={newField}
        onNewFieldChange={setNewField}
      />

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
        >
          {saving ? 'Saving...' : 'Save Template'}
        </Button>
      </div>
    </div>
  );
}