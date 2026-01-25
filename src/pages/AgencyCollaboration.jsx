import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, FileText, Loader2 } from "lucide-react";
import AgencyMessagingSystem from "../components/collaboration/AgencyMessagingSystem";
import SharedDocumentRepository from "../components/collaboration/SharedDocumentRepository";

export default function AgencyCollaboration() {
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: currentAgency } = useQuery({
    queryKey: ['myAgency', currentUser?.email],
    queryFn: async () => {
      if (currentUser?.agency_code) {
        const agencies = await base44.entities.Agency.filter({ agency_code: currentUser.agency_code });
        return agencies[0] || null;
      }
      return null;
    },
    enabled: !!currentUser?.agency_code
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-600">Please log in to access collaboration features</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Agency Collaboration</h1>
          <p className="text-slate-600">Securely communicate and share documents with other healthcare agencies</p>
        </div>

        <Tabs defaultValue="messages" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="messages" className="gap-2">
              <Mail className="w-4 h-4" />
              Messages
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="w-4 h-4" />
              Shared Documents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="mt-6">
            <AgencyMessagingSystem currentUser={currentUser} currentAgency={currentAgency} />
          </TabsContent>

          <TabsContent value="documents" className="mt-6">
            <SharedDocumentRepository currentUser={currentUser} currentAgency={currentAgency} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}