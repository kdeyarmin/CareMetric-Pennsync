import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  Search,
  ExternalLink,
  Copy,
  CheckCircle2,
  Plus,
  Sparkles,
  FileText
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { retrieveRelevantGuidelines } from "../smartNote/GuidelineContextRetriever";

export default function GuidelineReferencePanel({
  diagnosis,
  visitType,
  noteContent,
  onInsertGuideline,
  compact = false
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [relevantGuidelines, setRelevantGuidelines] = useState([]);
  const [copied, setCopied] = useState(null);
  const [_isLoadingRelevant, setIsLoadingRelevant] = useState(false);

  const { data: allGuidelines = [] } = useQuery({
    queryKey: ['activeGuidelines'],
    queryFn: () => base44.entities.MedicareGuideline.filter({ is_active: true }),
    initialData: [],
  });

  const loadRelevantGuidelines = useCallback(async () => {
    setIsLoadingRelevant(true);
    try {
      const relevant = await retrieveRelevantGuidelines({
        diagnosis,
        visitType,
        noteContent,
        maxGuidelines: 5
      });
      setRelevantGuidelines(relevant);
    } catch (error) {
      console.error('Error loading relevant guidelines:', error);
    }
    setIsLoadingRelevant(false);
  }, [diagnosis, visitType, noteContent]);

  // Auto-load relevant guidelines based on context
  useEffect(() => {
    if (diagnosis || visitType || noteContent) {
      loadRelevantGuidelines();
    }
  }, [diagnosis, visitType, noteContent, loadRelevantGuidelines]);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const searchedGuidelines = searchTerm 
    ? allGuidelines.filter(g => 
        g.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.keywords?.some(k => k.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    : [];

  const displayGuidelines = searchTerm ? searchedGuidelines : relevantGuidelines;

  const getCategoryColor = (category) => {
    const colors = {
      oasis: "bg-navy-100 text-navy-800",
      medicare_cop: "bg-red-100 text-red-800",
      clinical_documentation: "bg-blue-100 text-blue-800",
      home_health_regulations: "bg-indigo-100 text-indigo-800",
      quality_measures: "bg-yellow-100 text-yellow-800",
      compliance_audit: "bg-orange-100 text-orange-800",
      pdgm: "bg-navy-100 text-navy-800"
    };
    return colors[category] || "bg-slate-100 text-slate-800";
  };

  if (compact) {
    return (
      <Card className="border-blue-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600" />
            Quick Guidelines Reference
            {relevantGuidelines.length > 0 && (
              <Badge variant="outline">{relevantGuidelines.length} relevant</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 space-y-2">
          {displayGuidelines.slice(0, 3).map((guideline) => (
            <div key={guideline.id} className="p-2 bg-blue-50 rounded border border-blue-200">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-900 mb-1">{guideline.title}</p>
                  <p className="text-xs text-slate-600 line-clamp-2">{guideline.summary}</p>
                </div>
                {onInsertGuideline && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={() => onInsertGuideline(guideline.summary)}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-blue-200 bg-gradient-to-b from-blue-50 to-white">
      <CardHeader className="py-4">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            Clinical Guidelines Reference
          </div>
          <Badge className="bg-blue-600">
            {displayGuidelines.length} guidelines
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search all guidelines..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>

        {/* Context Notice */}
        {!searchTerm && relevantGuidelines.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-100 p-2 rounded">
            <Sparkles className="w-3 h-3" />
            Showing guidelines relevant to {diagnosis || visitType || 'this visit'}
          </div>
        )}

        {/* Guidelines List */}
        <ScrollArea className="h-96">
          <div className="space-y-3 pr-4">
            {displayGuidelines.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <FileText className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm">
                  {searchTerm ? 'No guidelines found' : 'No relevant guidelines found'}
                </p>
              </div>
            ) : (
              <Accordion type="single" collapsible className="space-y-2">
                {displayGuidelines.map((guideline) => (
                  <AccordionItem
                    key={guideline.id}
                    value={guideline.id}
                    className="border-2 rounded-lg bg-white"
                  >
                    <AccordionTrigger className="px-3 py-2 hover:no-underline">
                      <div className="flex items-start gap-2 flex-1 text-left">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge className={`${getCategoryColor(guideline.category)} text-xs`}>
                              {(guideline.category || '').replace(/_/g, ' ')}
                            </Badge>
                            {guideline.regulatory_citation && (
                              <Badge variant="outline" className="text-xs">
                                {guideline.regulatory_citation}
                              </Badge>
                            )}
                            {guideline.relevance_score > 0 && (
                              <Badge className="bg-green-100 text-green-800 text-xs">
                                {Math.round(guideline.relevance_score)} match
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium text-slate-900">{guideline.title}</p>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 space-y-3">
                      {/* Summary */}
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <p className="text-xs font-medium text-blue-900 mb-1">Summary:</p>
                        <p className="text-xs text-blue-800">{guideline.summary}</p>
                      </div>

                      {/* Keywords */}
                      {guideline.keywords?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-700 mb-1">Related Topics:</p>
                          <div className="flex flex-wrap gap-1">
                            {guideline.keywords.map((kw, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {kw}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Content Preview */}
                      <div className="bg-slate-50 p-3 rounded max-h-48 overflow-y-auto">
                        <div className="prose prose-sm max-w-none text-xs">
                          <ReactMarkdown>
                            {guideline.content_markdown?.substring(0, 800) + '...'}
                          </ReactMarkdown>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        {onInsertGuideline && (
                          <Button
                            size="sm"
                            onClick={() => onInsertGuideline(`[Per Medicare ${guideline.regulatory_citation || 'guidelines'}]: ${guideline.summary}`)}
                            className="bg-blue-600 hover:bg-blue-700 text-xs"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Insert Reference
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopy(guideline.summary, guideline.id)}
                          className="text-xs"
                        >
                          {copied === guideline.id ? (
                            <><CheckCircle2 className="w-3 h-3 mr-1" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3 mr-1" /> Copy</>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(guideline.url, '_blank')}
                          className="text-xs"
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          View Full
                        </Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}