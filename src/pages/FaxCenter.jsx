import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Clock, FileText, Inbox } from "lucide-react";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

const SendFaxPage = React.lazy(() => import("./SendFax"));
const FaxQueuePage = React.lazy(() => import("./FaxQueue"));
const DocumentLibraryPage = React.lazy(() => import("./DocumentLibrary"));
const IncomingFaxesPage = React.lazy(() => import("./IncomingFaxes"));

export default function FaxCenter() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get("tab") || "send";

  return (
    <PremiumFeatureGate featureName="Fax Center" featureDescription="Complete fax management solution" allowTrial={true}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6">
          
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Send className="w-6 h-6 text-white" />
              </div>
              Fax Center
            </h1>
            <p className="text-sm text-slate-600 mt-2">Professional fax management with AI-powered intelligence</p>
          </div>

          <Tabs defaultValue={initialTab} className="w-full">
            <TabsList className="w-full bg-white border-2 border-blue-200 shadow-sm p-1 h-auto grid grid-cols-4 gap-1">
              <TabsTrigger 
                value="send" 
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-sm font-medium py-2.5 rounded-md transition-all"
              >
                <Send className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Send Fax</span>
                <span className="sm:hidden">Send</span>
              </TabsTrigger>
              <TabsTrigger 
                value="inbox" 
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-sm font-medium py-2.5 rounded-md transition-all"
              >
                <Inbox className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Inbox</span>
                <span className="sm:hidden">In</span>
              </TabsTrigger>
              <TabsTrigger 
                value="queue" 
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-sm font-medium py-2.5 rounded-md transition-all"
              >
                <Clock className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Queue</span>
                <span className="sm:hidden">Queue</span>
              </TabsTrigger>
              <TabsTrigger 
                value="library" 
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-sm font-medium py-2.5 rounded-md transition-all"
              >
                <FileText className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Library</span>
                <span className="sm:hidden">Docs</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-4">
              <TabsContent value="send" className="m-0">
                <React.Suspense fallback={<LoadingState />}>
                  <SendFaxPage />
                </React.Suspense>
              </TabsContent>
              
              <TabsContent value="inbox" className="m-0">
                <React.Suspense fallback={<LoadingState />}>
                  <IncomingFaxesPage />
                </React.Suspense>
              </TabsContent>

              <TabsContent value="queue" className="m-0">
                <React.Suspense fallback={<LoadingState />}>
                  <FaxQueuePage />
                </React.Suspense>
              </TabsContent>

              <TabsContent value="library" className="m-0">
                <React.Suspense fallback={<LoadingState />}>
                  <DocumentLibraryPage />
                </React.Suspense>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </PremiumFeatureGate>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    </div>
  );
}