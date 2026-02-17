import React from "react";
import { FileText, FolderOpen, Tag, Users } from "lucide-react";

export default function DocumentLibraryStats({ documents }) {
  const totalDocs = documents.length;
  const categories = [...new Set(documents.map(d => d.category).filter(Boolean))];
  const patients = [...new Set(documents.map(d => d.patient_name).filter(Boolean))];
  const allTags = [...new Set(documents.flatMap(d => d.tags || []))];

  const stats = [
    { label: "Documents", value: totalDocs, icon: FileText, color: "text-blue-600 bg-blue-50" },
    { label: "Categories", value: categories.length, icon: FolderOpen, color: "text-purple-600 bg-purple-50" },
    { label: "Patients", value: patients.length, icon: Users, color: "text-green-600 bg-green-50" },
    { label: "Tags", value: allTags.length, icon: Tag, color: "text-amber-600 bg-amber-50" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {stats.map(s => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="flex items-center gap-2.5 p-2.5 bg-white rounded-lg border border-slate-200">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.color}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900 leading-none">{s.value}</p>
              <p className="text-[10px] text-slate-500">{s.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}