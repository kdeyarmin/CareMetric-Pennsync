import { useState, useMemo } from "react";
import { openExternalUrl } from "@/components/utils/security";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Eye, Loader2, CheckCircle, XCircle, FileText, Brain } from "lucide-react";
import { format } from "date-fns";

export default function FaxSearchInterface({ onSelectFaxForAI }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const { data: faxLogs = [], isLoading } = useQuery({
    queryKey: ['fax-search-logs'],
    queryFn: () => base44.entities.FaxLog.list('-created_date', 500),
    initialData: []
  });

  const filteredLogs = useMemo(() => {
    let filtered = [...faxLogs];

    if (statusFilter !== "all") {
      filtered = filtered.filter(log => log.status === statusFilter);
    }
    if (startDate) {
      filtered = filtered.filter(log => new Date(log.created_date) >= new Date(startDate));
    }
    if (endDate) {
      filtered = filtered.filter(log => new Date(log.created_date) <= new Date(endDate + 'T23:59:59'));
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log => {
        if (searchType === "all" || searchType === "metadata") {
          const metadataMatch =
            log.document_name?.toLowerCase().includes(query) ||
            log.to_number?.includes(query) ||
            log.to_name?.toLowerCase().includes(query) ||
            log.from_number?.includes(query) ||
            log.sent_by?.toLowerCase().includes(query);
          if (metadataMatch) return true;
        }
        if ((searchType === "all" || searchType === "content") && log.ocr_text) {
          return log.ocr_text.toLowerCase().includes(query);
        }
        return false;
      });
    }

    return filtered;
  }, [faxLogs, searchQuery, searchType, statusFilter, startDate, endDate]);

  const handleSearch = () => {
    setIsSearching(true);
    setTimeout(() => setIsSearching(false), 500);
  };

  const highlightText = (text, query) => {
    if (!query.trim() || !text) return text;
    // Escape regex metacharacters so a query like "a(b" can't throw, and use a
    // non-global anchored test regex — a global regex is stateful across .test()
    // calls and would skip-highlight alternating matches.
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    const testRe = new RegExp(`^${escaped}$`, 'i');
    return parts.map((part, i) =>
      testRe.test(part) ? <mark key={i} className="bg-yellow-200 px-1 rounded">{part}</mark> : part
    );
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'delivered': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-600" />;
      default: return <FileText className="w-4 h-4 text-slate-600" />;
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Fax Search
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Search Query</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Search by document name, recipient, sender..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} disabled={isSearching}>
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Search Type</Label>
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Fields</SelectItem>
                  <SelectItem value="metadata">Metadata Only</SelectItem>
                  <SelectItem value="content">Content Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="sending">Sending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-slate-600">
              Found <strong>{filteredLogs.length}</strong> fax{filteredLogs.length !== 1 ? 'es' : ''}
            </div>
            <Button variant="outline" size="sm" onClick={() => { setSearchQuery(""); setSearchType("all"); setStatusFilter("all"); setStartDate(""); setEndDate(""); }}>
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading ? (
          <Card><CardContent className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-2" /><p className="text-slate-500">Loading faxes...</p></CardContent></Card>
        ) : filteredLogs.length === 0 ? (
          <Card><CardContent className="p-12 text-center"><Search className="w-12 h-12 mx-auto text-slate-300 mb-3" /><p className="text-slate-500">{searchQuery ? "No faxes found matching your search" : "No faxes available"}</p></CardContent></Card>
        ) : (
          filteredLogs.map((log) => (
            <Card key={log.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">{getStatusIcon(log.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold text-slate-900">{highlightText(log.document_name || 'Untitled Fax', searchQuery)}</h4>
                        <Badge variant="outline" className="text-xs mt-1">{log.status}</Badge>
                      </div>
                      <span className="text-xs text-slate-500 whitespace-nowrap">{format(new Date(log.created_date), 'MMM d, h:mm a')}</span>
                    </div>
                    <div className="space-y-1 text-sm text-slate-600 mb-3">
                      <p><strong>To:</strong> {highlightText(log.to_name || log.to_number, searchQuery)}</p>
                      <p><strong>From:</strong> {highlightText(log.from_number, searchQuery)}</p>
                      {log.sent_by && <p><strong>Sent by:</strong> {highlightText(log.sent_by, searchQuery)}</p>}
                    </div>
                    {log.ocr_text && searchQuery && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
                        <p className="text-xs font-semibold text-slate-700 mb-1">Content Match:</p>
                        <p className="text-sm text-slate-800 line-clamp-3">{highlightText(log.ocr_text.substring(0, 300), searchQuery)}{log.ocr_text.length > 300 && '...'}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {log.document_url && (
                        <Button variant="outline" size="sm" onClick={() => openExternalUrl(log.document_url)}>
                          <Eye className="w-3 h-3 mr-1" /> View
                        </Button>
                      )}
                      {log.ocr_processed && onSelectFaxForAI && (
                        <Button variant="outline" size="sm" onClick={() => onSelectFaxForAI(log.id)} className="text-navy-600 hover:text-navy-700">
                          <Brain className="w-3 h-3 mr-1" /> AI Analyze
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}