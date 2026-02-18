import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ListFilter, Clock, AlertCircle, Send, CheckCircle2,
  Loader2, RefreshCw, Wifi, WifiOff, Folder, Search, Tag
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import FaxQueueItem from "@/components/fax/FaxQueueItem";
import FaxFolderManager from "@/components/fax/FaxFolderManager";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

export default function FaxQueue() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [retryingAll, setRetryingAll] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");

  React.useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allFaxes = [], isLoading } = useQuery({
    queryKey: ['faxQueue', currentUser?.email],
    queryFn: () => base44.entities.FaxHistory.filter(
      { user_email: currentUser.email },
      '-created_date',
      100
    ),
    enabled: !!currentUser?.email,
    refetchInterval: 8000
  });

  // Filter faxes by folder, search, and priority
  const filteredFaxes = allFaxes.filter(fax => {
    const matchesFolder = !selectedFolder || fax.folder_id === selectedFolder;
    const matchesSearch = !searchTerm || 
      fax.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fax.recipient_fax_number?.includes(searchTerm) ||
      fax.subject?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPriority = filterPriority === 'all' || fax.priority === filterPriority;
    return matchesFolder && matchesSearch && matchesPriority;
  });

  const queued = filteredFaxes.filter(f => f.status === 'queued');
  const sending = filteredFaxes.filter(f => f.status === 'sending');
  const failed = filteredFaxes.filter(f => f.status === 'failed');
  const scheduled = filteredFaxes.filter(f => f.status === 'scheduled');
  const completed = filteredFaxes.filter(f => f.status === 'sent' || f.status === 'delivered');

  const handleRetryAll = async () => {
    const retryable = [...queued, ...failed];
    if (retryable.length === 0) return;
    setRetryingAll(true);
    let successCount = 0;
    for (const fax of retryable) {
      if (!fax.document_urls?.length) continue;
      try {
        await base44.entities.FaxHistory.update(fax.id, { status: 'sending', error_message: '' });
        await base44.functions.invoke('sendFax', {
          to_fax_number: fax.recipient_fax_number,
          media_urls: fax.document_urls,
          fax_history_id: fax.id,
          from_fax_number: currentUser?.sending_fax_number || undefined
        });
        successCount++;
      } catch (err) {
        console.error("Retry failed for", fax.id, err);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['faxQueue'] });
    queryClient.invalidateQueries({ queryKey: ['faxHistory'] });
    toast.success(`Retried ${successCount} of ${retryable.length} faxes`);
    setRetryingAll(false);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['faxQueue'] });
  };

  const pendingCount = queued.length + sending.length + failed.length + scheduled.length;

  return (
    <PremiumFeatureGate featureName="Fax Queue" featureDescription="Monitor and manage your fax queue." allowTrial={true}>
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Sidebar - Folders */}
        <div className="lg:col-span-1">
          <FaxFolderManager 
            userEmail={currentUser?.email}
            onFolderSelect={(folder) => setSelectedFolder(folder?.id || null)}
          />
        </div>

        {/* Main Queue Area */}
        <div className="lg:col-span-3 space-y-4">
      {/* Header */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ListFilter className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            Fax Queue
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">Monitor, retry, and manage your outgoing faxes</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs ${isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {isOnline ? <><Wifi className="w-3 h-3 mr-1" /> Online</> : <><WifiOff className="w-3 h-3 mr-1" /> Offline</>}
          </Badge>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleRefresh}>
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
          {(queued.length > 0 || failed.length > 0) && isOnline && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={handleRetryAll}
              disabled={retryingAll}
            >
              {retryingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Retry All ({queued.length + failed.length})
            </Button>
          )}
          <Link to={createPageUrl("SendFax")}>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
              <Send className="w-3 h-3" /> Send New
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                placeholder="Search faxes..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-full sm:w-32 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <SummaryCard icon={Clock} label="Queued" count={queued.length} color="text-yellow-600" bg="bg-yellow-50" />
        <SummaryCard icon={Loader2} label="Sending" count={sending.length} color="text-blue-600" bg="bg-blue-50" spin />
        <SummaryCard icon={Clock} label="Scheduled" count={scheduled.length} color="text-purple-600" bg="bg-purple-50" />
        <SummaryCard icon={AlertCircle} label="Failed" count={failed.length} color="text-red-600" bg="bg-red-50" />
        <SummaryCard icon={CheckCircle2} label="Completed" count={completed.length} color="text-green-600" bg="bg-green-50" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pending">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="pending" className="text-xs sm:text-sm">
            Pending {pendingCount > 0 && <Badge className="ml-1.5 bg-yellow-100 text-yellow-800 text-[10px] px-1.5">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="completed" className="text-xs sm:text-sm">
            Completed
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs sm:text-sm">
            All ({allFaxes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <FaxList
            faxes={[...sending, ...queued, ...scheduled, ...failed]}
            isLoading={isLoading}
            emptyMessage="No pending faxes"
            emptyDescription="All faxes have been processed."
            userSendingFaxNumber={currentUser?.sending_fax_number}
          />
        </TabsContent>

        <TabsContent value="completed">
          <FaxList
            faxes={completed}
            isLoading={isLoading}
            emptyMessage="No completed faxes"
            emptyDescription="Sent faxes will appear here."
            userSendingFaxNumber={currentUser?.sending_fax_number}
          />
        </TabsContent>

        <TabsContent value="all">
          <FaxList
            faxes={allFaxes}
            isLoading={isLoading}
            emptyMessage="No faxes yet"
            emptyDescription="Send your first fax to get started."
            userSendingFaxNumber={currentUser?.sending_fax_number}
          />
        </TabsContent>
      </Tabs>
        </div>
      </div>
    </div>
    </PremiumFeatureGate>
  );
}

function SummaryCard({ icon: Icon, label, count, color, bg, spin }) {
  return (
    <div className={`rounded-xl border p-3 ${bg}`}>
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color} ${spin && count > 0 ? 'animate-spin' : ''}`} />
        <span className="text-xs font-medium text-slate-600">{label}</span>
      </div>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{count}</p>
    </div>
  );
}

function FaxList({ faxes, isLoading, emptyMessage, emptyDescription, userSendingFaxNumber }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (faxes.length === 0) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500">{emptyMessage}</p>
        <p className="text-xs text-slate-400 mt-1">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {faxes.map(fax => (
        <FaxQueueItem key={fax.id} fax={fax} userSendingFaxNumber={userSendingFaxNumber} />
      ))}
    </div>
  );
}