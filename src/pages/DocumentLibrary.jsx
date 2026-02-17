import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Library, LayoutGrid, List } from "lucide-react";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";
import DocumentLibraryFilters from "@/components/fax/DocumentLibraryFilters";
import DocumentLibraryCard from "@/components/fax/DocumentLibraryCard";
import DocumentLibraryStats from "@/components/fax/DocumentLibraryStats";

export default function DocumentLibrary() {
  const [filters, setFilters] = useState({ search: "", category: "", tag: "", dateRange: "" });
  const [viewMode, setViewMode] = useState("grid");

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: allDocuments = [], isLoading } = useQuery({
    queryKey: ["faxDocuments", currentUser?.email],
    queryFn: () => base44.entities.FaxDocument.filter(
      { user_email: currentUser.email },
      "-created_date",
      200
    ),
    enabled: !!currentUser?.email
  });

  // Collect all unique tags for filter dropdown
  const availableTags = useMemo(() => {
    const tagSet = new Set();
    allDocuments.forEach(d => (d.tags || []).forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }, [allDocuments]);

  // Filter documents
  const filteredDocuments = useMemo(() => {
    let docs = allDocuments;

    // Free text search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      docs = docs.filter(d => {
        const searchable = [
          d.file_name, d.patient_name, d.patient_dob, d.mrn,
          d.provider_name, d.document_type, d.category,
          d.diagnosis, d.summary, d.recipient_name,
          ...(d.tags || [])
        ].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(q);
      });
    }

    // Category filter
    if (filters.category) {
      docs = docs.filter(d => d.category === filters.category);
    }

    // Tag filter
    if (filters.tag) {
      docs = docs.filter(d => (d.tags || []).includes(filters.tag));
    }

    // Date range
    if (filters.dateRange) {
      const days = parseInt(filters.dateRange);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      docs = docs.filter(d => d.created_date && new Date(d.created_date) >= cutoff);
    }

    return docs;
  }, [allDocuments, filters]);

  return (
    <PremiumFeatureGate featureName="Document Library" featureDescription="AI-powered document library with search, filtering, and auto-categorization." allowTrial={true}>
      <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto pb-20 sm:pb-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Library className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Document Library
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Search and browse all fax documents with AI-extracted metadata
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="text-xs bg-slate-100 text-slate-600 border border-slate-200">
              {filteredDocuments.length} of {allDocuments.length} docs
            </Badge>
            <div className="flex border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 ${viewMode === "grid" ? "bg-blue-100 text-blue-700" : "bg-white text-slate-400 hover:text-slate-600"}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 ${viewMode === "list" ? "bg-blue-100 text-blue-700" : "bg-white text-slate-400 hover:text-slate-600"}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-4">
          <DocumentLibraryStats documents={allDocuments} />
        </div>

        {/* Filters */}
        <div className="mb-4">
          <DocumentLibraryFilters
            filters={filters}
            onFiltersChange={setFilters}
            availableTags={availableTags}
          />
        </div>

        {/* Documents */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Library className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">
              {allDocuments.length === 0 ? "No documents yet" : "No documents match your filters"}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {allDocuments.length === 0
                ? "Documents will appear here when you send faxes with AI analysis"
                : "Try adjusting your search or filters"
              }
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredDocuments.map(doc => (
              <DocumentLibraryCard key={doc.id} doc={doc} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredDocuments.map(doc => (
              <DocumentLibraryListItem key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </PremiumFeatureGate>
  );
}

function DocumentLibraryListItem({ doc }) {
  const { format } = require("date-fns");

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

  function getCatColor(cat) {
    for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
      if (cat?.toLowerCase().includes(key.toLowerCase())) return val;
    }
    return "bg-slate-100 text-slate-600";
  }

  return (
    <a
      href={doc.file_url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${getCatColor(doc.category)}`}>
        <Library className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{doc.file_name}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {doc.category && <Badge className={`text-[8px] px-1 py-0 ${getCatColor(doc.category)}`}>{doc.category}</Badge>}
          {doc.patient_name && <span className="text-[10px] text-slate-500">{doc.patient_name}</span>}
          {doc.mrn && <span className="text-[10px] text-slate-400">MRN: {doc.mrn}</span>}
          {doc.tags?.slice(0, 3).map((t, i) => (
            <Badge key={i} className="text-[8px] px-1 py-0 bg-slate-50 text-slate-400 border border-slate-200 font-normal">{t}</Badge>
          ))}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[10px] text-slate-400">
          {doc.created_date ? format(new Date(doc.created_date), "MMM d, yyyy") : ""}
        </p>
        {doc.recipient_name && (
          <p className="text-[10px] text-slate-400 truncate max-w-[100px]">→ {doc.recipient_name}</p>
        )}
      </div>
    </a>
  );
}