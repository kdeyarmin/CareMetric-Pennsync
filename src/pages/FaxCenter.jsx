import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Clock, FileText } from "lucide-react";
import SendFax from "./SendFax";
import FaxQueue from "./FaxQueue";
import DocumentLibrary from "./DocumentLibrary";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

export default function FaxCenter() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get("tab") || "send";

  return (
    <PremiumFeatureGate featureName="Fax Center" featureDescription="Send faxes, manage your queue, and browse documents." allowTrial={true}>
      <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300 min-h-screen">
        <div className="mb-4">
          <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Send className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            Fax Center
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">Send, track, and manage all your faxes and documents</p>
        </div>

        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="send" className="text-xs sm:text-sm gap-1">
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Send</span> Fax
            </TabsTrigger>
            <TabsTrigger value="queue" className="text-xs sm:text-sm gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Fax</span> Queue
            </TabsTrigger>
            <TabsTrigger value="library" className="text-xs sm:text-sm gap-1">
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Doc</span> Library
            </TabsTrigger>
          </TabsList>

          <TabsContent value="send">
            <SendFaxEmbed />
          </TabsContent>
          <TabsContent value="queue">
            <FaxQueueEmbed />
          </TabsContent>
          <TabsContent value="library">
            <DocumentLibraryEmbed />
          </TabsContent>
        </Tabs>
      </div>
    </PremiumFeatureGate>
  );
}

// Thin wrappers that render the existing pages without their own outer chrome
// We import them directly and render - they already handle their own data/logic
function SendFaxEmbed() {
  return <SendFax />;
}
function FaxQueueEmbed() {
  return <FaxQueue />;
}
function DocumentLibraryEmbed() {
  return <DocumentLibrary />;
}