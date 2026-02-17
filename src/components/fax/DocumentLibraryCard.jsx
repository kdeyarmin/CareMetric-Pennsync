import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, User, Calendar, Stethoscope, Hash, Tag,
  ExternalLink, Send, Clock
} from "lucide-react";
import { format } from "date-fns";

const CATEGORY_COLORS = {
  "Lab Results": "bg-blue-100 text-blue-700 border-blue-200",
  "Referral": "bg-purple-100 text-purple-700 border-purple-200",
  "Discharge Summary": "bg-amber-100 text-amber-700 border-amber-200",
  "Progress Note": "bg-green-100 text-green-700 border-green-200",
  "Medical Records": "bg-slate-100 text-slate-700 border-slate-200",
  "Prescription": "bg-pink-100 text-pink-700 border-pink-200",
  "Insurance": "bg-cyan-100 text-cyan-700 border-cyan-200",
  "Consent Form": "bg-orange-100 text-orange-700 border-orange-200",
  "Imaging Report": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "Operative Report": "bg-red-100 text-red-700 border-red-200",
};

function getCatStyle(category) {
  for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
    if (category?.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return "bg-slate-50 text-slate-600 border-slate-200";
}

export default function DocumentLibraryCard({ doc }) {
  const catStyle = getCatStyle(doc.category);

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all p-3 sm:p-4 space-y-2.5">
      {/* Top row: icon + name + category */}
      <div className="flex items-start gap-2.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${catStyle}`}>
          <FileText className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{doc.file_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {doc.category && (
              <Badge className={`text-[9px] px-1.5 py-0 border ${catStyle}`}>{doc.category}</Badge>
            )}
            {doc.document_type && doc.document_type !== doc.category && (
              <span className="text-[10px] text-slate-400">{doc.document_type}</span>
            )}
          </div>
        </div>
        <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
            <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
          </Button>
        </a>
      </div>

      {/* Metadata fields */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {doc.patient_name && (
          <div className="flex items-center gap-1.5 min-w-0">
            <User className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-500">Patient:</span>
            <span className="text-[11px] font-medium text-slate-700 truncate">{doc.patient_name}</span>
          </div>
        )}
        {doc.patient_dob && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Calendar className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-500">DOB:</span>
            <span className="text-[11px] font-medium text-slate-700">{doc.patient_dob}</span>
          </div>
        )}
        {doc.mrn && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Hash className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-500">MRN:</span>
            <span className="text-[11px] font-medium text-slate-700">{doc.mrn}</span>
          </div>
        )}
        {doc.provider_name && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Stethoscope className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-500">Provider:</span>
            <span className="text-[11px] font-medium text-slate-700 truncate">{doc.provider_name}</span>
          </div>
        )}
        {doc.date_of_service && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Calendar className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-500">Service:</span>
            <span className="text-[11px] font-medium text-slate-700">{doc.date_of_service}</span>
          </div>
        )}
        {doc.diagnosis && (
          <div className="flex items-center gap-1.5 min-w-0 col-span-2">
            <Stethoscope className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-[10px] text-slate-500">Dx:</span>
            <span className="text-[11px] font-medium text-slate-700 truncate">{doc.diagnosis}</span>
          </div>
        )}
      </div>

      {/* Tags */}
      {doc.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <Tag className="w-2.5 h-2.5 text-slate-300" />
          {doc.tags.map((tag, i) => (
            <Badge key={i} className="text-[8px] px-1.5 py-0 bg-slate-50 text-slate-500 font-normal border border-slate-200">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Summary + footer */}
      {doc.summary && (
        <p className="text-[10px] text-slate-400 italic leading-relaxed line-clamp-2">{doc.summary}</p>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-slate-300" />
          <span className="text-[10px] text-slate-400">
            {doc.created_date ? format(new Date(doc.created_date), "MMM d, yyyy h:mm a") : "—"}
          </span>
        </div>
        {doc.recipient_name && (
          <div className="flex items-center gap-1">
            <Send className="w-2.5 h-2.5 text-slate-300" />
            <span className="text-[10px] text-slate-400 truncate max-w-[120px]">To: {doc.recipient_name}</span>
          </div>
        )}
      </div>
    </div>
  );
}