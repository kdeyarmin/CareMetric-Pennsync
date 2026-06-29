import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Search, 
  FileText, 
  Eye, 
  Filter,
  Loader2,
  AlertCircle,
  Database
} from "lucide-react";
import { toast } from "sonner";

export default function PDFSearchInterface() {
  const [searchQuery, setSearchQuery] = useState('');
  const [documentType, setDocumentType] = useState('all');
  const [patientFilter, setPatientFilter] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const { data: indexedCount = 0 } = useQuery({
    queryKey: ['pdf-index-count'],
    queryFn: async () => {
      const docs = await base44.entities.PDFIndex.list('-created_date', 1);
      return docs.length;
    }
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Please enter a search term");
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    
    try {
      const response = await base44.functions.invoke('searchPDFs', {
        query: searchQuery,
        document_type: documentType !== 'all' ? documentType : undefined,
        patient_id: patientFilter || undefined,
        fuzzy: true,
        limit: 50
      });

      const results = response.data?.results || [];
      setSearchResults(results);

      if (results.length === 0) {
        toast.info("No results found");
      }
    } catch (error) {
      console.error("Search error:", error);
      toast.error(`Search failed: ${error.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const highlightText = (text, terms) => {
    if (!text) return '';
    // Escape HTML entities first to prevent XSS from snippet content
    const escapeHtml = (str) =>
      str.replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;')
         .replace(/'/g, '&#39;');

    let highlighted = escapeHtml(text);
    if (!terms || terms.length === 0) return highlighted;

    terms.forEach(term => {
      // Escape regex metacharacters in the search term
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedHtmlTerm = escapeHtml(term);
      const regex = new RegExp(`(${escapedTerm})`, 'gi');
      highlighted = highlighted.replace(regex, `<mark class="bg-yellow-200">${escapedHtmlTerm}</mark>`);
    });

    return highlighted;
  };

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              <span>PDF Document Search</span>
            </div>
            <Badge variant="outline" className="flex items-center gap-1">
              <Database className="w-3 h-3" />
              {indexedCount} Documents Indexed
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Input */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search within PDF documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-10 text-base"
              />
            </div>
            <Button 
              onClick={handleSearch}
              disabled={isSearching}
              className="min-w-[120px]"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Search
                </>
              )}
            </Button>
          </div>

          {/* Filters */}
          <div className="flex gap-2 items-center">
            <Filter className="w-4 h-4 text-slate-500" />
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="consent">Consent</SelectItem>
                <SelectItem value="assessment">Assessment</SelectItem>
                <SelectItem value="visit">Visit</SelectItem>
                <SelectItem value="care_plan">Care Plan</SelectItem>
                <SelectItem value="signature">Signature</SelectItem>
                <SelectItem value="template">Template</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Patient ID (optional)"
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              className="w-64"
            />
          </div>
        </CardContent>
      </Card>

      {/* Search Results */}
      {hasSearched && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {searchResults.length > 0 
                ? `${searchResults.length} Result${searchResults.length !== 1 ? 's' : ''} Found`
                : 'No Results Found'
              }
            </CardTitle>
          </CardHeader>
          <CardContent>
            {searchResults.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No documents match your search criteria</p>
                <p className="text-sm text-slate-500 mt-1">Try different keywords or adjust filters</p>
              </div>
            ) : (
              <div className="space-y-3">
                {searchResults.map((result, index) => (
                  <div
                    key={result.id || index}
                    className="p-4 border rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                          <h4 className="font-semibold text-slate-900 truncate">
                            {result.document_name}
                          </h4>
                          <Badge className="bg-blue-100 text-blue-800">
                            {result.document_type}
                          </Badge>
                          <Badge variant="outline">
                            Score: {Math.round(result.search_score)}
                          </Badge>
                        </div>

                        {/* Snippet with highlights */}
                        <p 
                          className="text-sm text-slate-600 mb-2 line-clamp-2"
                          dangerouslySetInnerHTML={{ 
                            __html: highlightText(result.snippet, result.matched_terms) 
                          }}
                        />

                        {/* Matched Terms */}
                        {result.matched_terms?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {result.matched_terms.map((term, idx) => (
                              <Badge key={idx} className="bg-yellow-100 text-yellow-800 text-xs">
                                {term}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Page Matches */}
                        {result.page_matches?.length > 0 && (
                          <div className="text-xs text-slate-500">
                            Found on pages: {result.page_matches.map(p => p.page_number).join(', ')}
                          </div>
                        )}

                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                          <span>
                            {result.metadata?.page_count || 0} pages
                          </span>
                          {result.patient_id && (
                            <span>Patient: {result.patient_id}</span>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(result.pdf_url, '_blank')}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}