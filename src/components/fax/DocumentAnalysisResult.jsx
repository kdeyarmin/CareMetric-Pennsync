import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sparkles, User, Calendar, FileText, Stethoscope, Hash,
  Tag, ChevronDown, ChevronUp, Pencil, Check, X, RotateCcw,
  FolderOpen, CheckCircle2
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const CATEGORY_OPTIONS = [
  "Lab Results", "Referral", "Discharge Summary", "Progress Note",
  "Medical Records", "Prescription", "Insurance", "Consent Form",
  "Imaging Report", "Operative Report", "Other"
];

const CATEGORY_COLORS = {
  "Lab Results": "bg-blue-100 text-blue-700",
  "Referral": "bg-purple-100 text-purple-700",
  "Discharge Summary": "bg-amber-100 text-amber-700",
  "Progress Note": "bg-green-100 text-green-700",
  "Medical Records": "bg-slate-100 text-slate-700",
  "Prescription": "bg-pink-100 text-pink-700",
  "Insurance": "bg-cyan-100 text-cyan-700",
  "Consent Form": "bg-orange-100 text-orange-700",
  "Imaging Report": "bg-indigo-100 text-indigo-700",
  "Operative Report": "bg-red-100 text-red-700",
};

function getCategoryColor(category) {
  for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
    if (category?.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return "bg-slate-100 text-slate-600";
}

export default function DocumentAnalysisResult({
  analysis,
  expanded,
  onToggle,
  onApplyName,
  onUpdateAnalysis,
  autoApplied
}) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [newTag, setNewTag] = useState("");

  if (!analysis) return null;

  const fields = [
    { key: "patient_name", label: "Patient", icon: User },
    { key: "patient_dob", label: "DOB", icon: Calendar },
    { key: "mrn", label: "MRN", icon: Hash },
    { key: "provider_name", label: "Provider", icon: Stethoscope },
    { key: "date_of_service", label: "Date of Service", icon: Calendar },
    { key: "document_type", label: "Type", icon: FileText },
    { key: "diagnosis", label: "Diagnosis", icon: Stethoscope },
  ].filter(f => editing ? true : analysis[f.key]);

  const hasTags = analysis.tags?.length > 0 || editing;
  const hasCategory = !!analysis.category;

  const startEditing = (e) => {
    e.stopPropagation();
    setEditData({
      suggested_name: analysis.suggested_name || "",
      category: analysis.category || "",
      tags: [...(analysis.tags || [])],
      patient_name: analysis.patient_name || "",
      patient_dob: analysis.patient_dob || "",
      mrn: analysis.mrn || "",
      provider_name: analysis.provider_name || "",
      date_of_service: analysis.date_of_service || "",
      document_type: analysis.document_type || "",
      diagnosis: analysis.diagnosis || "",
    });
    setEditing(true);
  };

  const cancelEditing = (e) => {
    e.stopPropagation();
    setEditing(false);
    setEditData(null);
    setNewTag("");
  };

  const saveEdits = (e) => {
    e.stopPropagation();
    if (onUpdateAnalysis) {
      onUpdateAnalysis({ ...analysis, ...editData });
    }
    if (editData.suggested_name && editData.suggested_name !== analysis.suggested_name && onApplyName) {
      onApplyName(editData.suggested_name);
    }
    setEditing(false);
    setEditData(null);
    setNewTag("");
    toast.success("Document details updated");
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !editData.tags.includes(tag)) {
      setEditData(prev => ({ ...prev, tags: [...prev.tags, tag] }));
      setNewTag("");
    }
  };

  const removeTag = (tagToRemove) => {
    setEditData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tagToRemove) }));
  };

  const currentData = editing ? editData : analysis;

  return (
    <div className="border border-purple-200 bg-gradient-to-r from-purple-50/60 to-blue-50/40 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-purple-50/50 transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3 h-3 text-purple-500 flex-shrink-0" />
          <span className="text-[10px] font-medium text-purple-700 truncate">AI Analysis</span>
          {hasCategory && (
            <Badge className={`text-[8px] px-1 py-0 ${getCategoryColor(analysis.category)}`}>
              {analysis.category}
            </Badge>
          )}
          {autoApplied && (
            <Badge className="text-[8px] px-1 py-0 bg-green-100 text-green-700">
              <CheckCircle2 className="w-2 h-2 mr-0.5" /> Auto-filed
            </Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {/* Action bar */}
          <div className="flex items-center justify-end gap-1">
            {!editing ? (
              <Button
                size="sm" variant="ghost"
                className="h-5 px-1.5 text-[9px] text-purple-600 hover:bg-purple-100 gap-0.5"
                onClick={startEditing}
              >
                <Pencil className="w-2.5 h-2.5" /> Edit / Override
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-slate-500 hover:bg-slate-100 gap-0.5" onClick={cancelEditing}>
                  <X className="w-2.5 h-2.5" /> Cancel
                </Button>
                <Button size="sm" className="h-5 px-1.5 text-[9px] bg-purple-600 hover:bg-purple-700 text-white gap-0.5" onClick={saveEdits}>
                  <Check className="w-2.5 h-2.5" /> Save
                </Button>
              </>
            )}
          </div>

          {/* Suggested name */}
          {(currentData.suggested_name || editing) && (
            <div className="flex items-center gap-1.5 bg-white rounded p-1.5 border border-purple-100">
              <Pencil className="w-3 h-3 text-purple-500 flex-shrink-0" />
              <span className="text-[10px] text-slate-500 flex-shrink-0">Name:</span>
              {editing ? (
                <Input
                  value={editData.suggested_name}
                  onChange={e => setEditData(prev => ({ ...prev, suggested_name: e.target.value }))}
                  className="h-5 text-[10px] px-1 py-0 border-purple-200"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="text-[10px] font-medium text-slate-800 truncate flex-1">{analysis.suggested_name}</span>
                  {onApplyName && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-5 px-1.5 text-[9px] text-purple-600 hover:bg-purple-100"
                      onClick={(e) => { e.stopPropagation(); onApplyName(analysis.suggested_name); }}
                    >
                      <Check className="w-2.5 h-2.5 mr-0.5" /> Rename
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Category */}
          <div className="flex items-center gap-1.5 bg-white rounded p-1.5 border border-purple-100">
            <FolderOpen className="w-3 h-3 text-purple-500 flex-shrink-0" />
            <span className="text-[10px] text-slate-500 flex-shrink-0">Category:</span>
            {editing ? (
              <Select
                value={editData.category}
                onValueChange={val => setEditData(prev => ({ ...prev, category: val }))}
              >
                <SelectTrigger className="h-5 text-[10px] px-1 py-0 border-purple-200 flex-1" onClick={e => e.stopPropagation()}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge className={`text-[8px] px-1.5 py-0 ${getCategoryColor(analysis.category)}`}>
                {analysis.category || "Uncategorized"}
              </Badge>
            )}
          </div>

          {/* Extracted fields */}
          {fields.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {fields.map(f => {
                const Icon = f.icon;
                return (
                  <div key={f.key} className="flex items-center gap-1 min-w-0">
                    <Icon className="w-2.5 h-2.5 text-slate-400 flex-shrink-0" />
                    <span className="text-[9px] text-slate-400 flex-shrink-0">{f.label}:</span>
                    {editing ? (
                      <Input
                        value={editData[f.key]}
                        onChange={e => setEditData(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className="h-4 text-[10px] px-1 py-0 border-slate-200 flex-1"
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="text-[10px] font-medium text-slate-700 truncate">{analysis[f.key]}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tags */}
          {hasTags && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1 items-center">
                <Tag className="w-2.5 h-2.5 text-slate-400" />
                {(editing ? editData.tags : analysis.tags || []).map((tag, i) => (
                  <Badge key={i} className="text-[8px] px-1.5 py-0 bg-slate-100 text-slate-600 font-normal gap-0.5">
                    {tag}
                    {editing && (
                      <button onClick={(e) => { e.stopPropagation(); removeTag(tag); }} className="ml-0.5 hover:text-red-500">
                        <X className="w-2 h-2" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {editing && (
                <div className="flex gap-1">
                  <Input
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="Add tag..."
                    className="h-5 text-[10px] px-1.5 py-0 border-slate-200 flex-1"
                    onClick={e => e.stopPropagation()}
                  />
                  <Button size="sm" variant="outline" className="h-5 px-1.5 text-[9px]" onClick={(e) => { e.stopPropagation(); addTag(); }}>
                    Add
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Confidence */}
          {analysis.confidence != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-400">Confidence:</span>
              <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    analysis.confidence >= 80 ? 'bg-green-500' :
                    analysis.confidence >= 50 ? 'bg-amber-500' : 'bg-red-400'
                  }`}
                  style={{ width: `${analysis.confidence}%` }}
                />
              </div>
              <span className="text-[9px] font-medium text-slate-500">{analysis.confidence}%</span>
            </div>
          )}

          {/* Summary */}
          {analysis.summary && !editing && (
            <p className="text-[10px] text-slate-500 italic leading-relaxed">{analysis.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}