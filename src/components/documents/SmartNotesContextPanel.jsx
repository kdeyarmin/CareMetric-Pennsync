import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Brain, Copy, Plus, Search, FileText, CheckCircle2 } from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function SmartNotesContextPanel({ patientId, onInsertSnippet }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedIndex, setCopiedIndex] = useState(null);

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisitsForDocs', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId, status: 'completed' }, '-visit_date', 20),
    enabled: !!patientId,
  });

  const filteredVisits = visits.filter(visit => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      visit.nurse_notes?.toLowerCase().includes(term) ||
      visit.visit_type?.toLowerCase().includes(term) ||
      visit.visit_date?.includes(term)
    );
  });

  const handleCopySnippet = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleInsertSnippet = (text) => {
    onInsertSnippet?.(text);
  };

  const extractKeySnippets = (noteText) => {
    if (!noteText || noteText.length < 50) return noteText ? [noteText] : [];
    
    // Split by common delimiters
    const sentences = noteText.split(/\.\s+/).filter(s => s.trim().length > 20);
    
    // Return first 3 meaningful sentences
    return sentences.slice(0, 3).map(s => s.trim() + '.');
  };

  if (visits.length === 0) {
    return (
      <Card className="border-2 border-blue-200 bg-blue-50">
        <CardContent className="p-6 text-center">
          <Brain className="w-12 h-12 text-blue-300 mx-auto mb-3" />
          <p className="text-sm text-blue-800">No visit notes available for this patient yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200 bg-gradient-to-br from-navy-50 to-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="w-5 h-5 text-navy-600" />
          Smart Notes Context
          <Badge className="ml-2 bg-navy-600 text-white">{visits.length} visits</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search visit notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Visit Notes List */}
        <div className="space-y-3 max-h-[500px] overflow-y-auto">
          {filteredVisits.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No matching notes found</p>
          ) : (
            filteredVisits.map((visit, index) => {
              const snippets = extractKeySnippets(visit.nurse_notes);
              
              return (
                <div key={visit.id} className="bg-white p-3 rounded-lg border border-navy-200">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-navy-600" />
                        <span className="text-sm font-semibold text-slate-900">
                          {visit.visit_type?.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {formatEastern(visit.visit_date, 'MMM d, yyyy')}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Snippets */}
                  <div className="space-y-2">
                    {snippets.map((snippet, sIdx) => (
                      <div key={sIdx} className="bg-navy-50 p-2 rounded text-sm">
                        <p className="text-slate-700 mb-2">{snippet}</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopySnippet(snippet, `${index}-${sIdx}`)}
                            className="h-7 text-xs"
                          >
                            {copiedIndex === `${index}-${sIdx}` ? (
                              <><CheckCircle2 className="w-3 h-3 mr-1" /> Copied</>
                            ) : (
                              <><Copy className="w-3 h-3 mr-1" /> Copy</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleInsertSnippet(snippet)}
                            className="h-7 text-xs bg-navy-600 hover:bg-navy-700"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Insert
                          </Button>
                        </div>
                      </div>
                    ))}

                    {/* Full Note Option */}
                    {visit.nurse_notes && visit.nurse_notes.length > 200 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleInsertSnippet(visit.nurse_notes)}
                        className="w-full text-xs text-navy-600 hover:text-navy-700 hover:bg-navy-50"
                      >
                        Insert Full Note ({visit.nurse_notes.length} chars)
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}