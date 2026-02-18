import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare, CheckCircle, Target, Users, Loader2, Shield, Building2
} from "lucide-react";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";
import TeamMessageThread from "@/components/team/TeamMessageThread";
import TeamTaskBoard from "@/components/team/TeamTaskBoard";
import TeamCarePlanOverview from "@/components/team/TeamCarePlanOverview";

const CHANNELS = [
  { id: "general", label: "General" },
  { id: "urgent", label: "Urgent" },
  { id: "patient_care", label: "Patient Care" },
  { id: "scheduling", label: "Scheduling" },
  { id: "compliance", label: "Compliance" },
];

export default function TeamCollaboration() {
  const [activeChannel, setActiveChannel] = useState("general");

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const agencyId = currentUser?.agency_id;

  const { data: agency } = useQuery({
    queryKey: ["myAgency", agencyId],
    queryFn: () => base44.entities.Agency.filter({ agency_code: agencyId }),
    enabled: !!agencyId,
    select: (data) => data?.[0],
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["teamMembers"],
    queryFn: () => base44.entities.User.list(),
    enabled: !!agencyId,
    select: (users) => users.filter(u => u.agency_id === agencyId),
  });

  // Unread message counts per channel
  const { data: allMessages = [] } = useQuery({
    queryKey: ["teamMessagesAll", agencyId],
    queryFn: () => base44.entities.TeamMessage.filter({ agency_id: agencyId }, "-created_date", 500),
    enabled: !!agencyId,
    refetchInterval: 15000,
  });

  const getUnreadCount = (channel) =>
    allMessages.filter(m => m.channel === channel && m.sender_email !== currentUser?.email && !(m.read_by || []).includes(currentUser?.email)).length;

  const totalUnread = allMessages.filter(m => m.sender_email !== currentUser?.email && !(m.read_by || []).includes(currentUser?.email)).length;

  if (userLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  if (!agencyId) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center mt-20">
        <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-800 mb-2">Enterprise Feature</h2>
        <p className="text-sm text-slate-600">
          Team Collaboration is available for enterprise agency accounts. Join an agency in Settings to unlock team messaging, shared task assignments, and collaborative care plans.
        </p>
      </div>
    );
  }

  return (
    <PremiumFeatureGate featureName="Team Collaboration" featureDescription="Secure team messaging, shared tasks, and collaborative care plans for agency teams." allowTrial={true}>
      <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300 min-h-screen">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Team Collaboration
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              {agency?.agency_name || "Your Agency"} · {teamMembers.length} member{teamMembers.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Badge className="bg-green-100 text-green-700 text-xs">
            <Shield className="w-3 h-3 mr-1" /> HIPAA Secure
          </Badge>
        </div>

        <Tabs defaultValue="messages" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="messages" className="text-xs sm:text-sm gap-1 relative">
              <MessageSquare className="w-3.5 h-3.5" />
              Messages
              {totalUnread > 0 && (
                <Badge className="bg-red-500 text-white text-[9px] rounded-full px-1.5 py-0 ml-1">{totalUnread}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs sm:text-sm gap-1">
              <CheckCircle className="w-3.5 h-3.5" />
              Shared Tasks
            </TabsTrigger>
            <TabsTrigger value="careplans" className="text-xs sm:text-sm gap-1">
              <Target className="w-3.5 h-3.5" />
              Care Plans
            </TabsTrigger>
          </TabsList>

          {/* Messages Tab */}
          <TabsContent value="messages">
            <Card>
              <div className="flex border-b">
                {/* Channel sidebar */}
                <div className="w-28 sm:w-36 border-r flex-shrink-0 bg-slate-50">
                  {CHANNELS.map(ch => {
                    const unread = getUnreadCount(ch.id);
                    return (
                      <button
                        key={ch.id}
                        onClick={() => setActiveChannel(ch.id)}
                        className={`w-full text-left px-3 py-2.5 text-xs sm:text-sm border-b last:border-0 flex items-center justify-between transition-colors ${
                          activeChannel === ch.id ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span className="truncate">{ch.label}</span>
                        {unread > 0 && (
                          <Badge className="bg-red-500 text-white text-[9px] rounded-full px-1.5 py-0 ml-1 flex-shrink-0">{unread}</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Chat area */}
                <div className="flex-1 min-w-0">
                  <TeamMessageThread
                    agencyId={agencyId}
                    channel={activeChannel}
                    currentUser={currentUser}
                    teamMembers={teamMembers}
                  />
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks">
            <TeamTaskBoard agencyId={agencyId} currentUser={currentUser} teamMembers={teamMembers} />
          </TabsContent>

          {/* Care Plans Tab */}
          <TabsContent value="careplans">
            <TeamCarePlanOverview agencyId={agencyId} teamMembers={teamMembers} />
          </TabsContent>
        </Tabs>
      </div>
    </PremiumFeatureGate>
  );
}