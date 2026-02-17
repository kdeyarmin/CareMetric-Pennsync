import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Users, User, Shield } from "lucide-react";
import MessageThread from "./MessageThread";

export default function PatientMessagingPanel({ patientId, currentUser, patientName }) {
  const { data: teamMessages = [] } = useQuery({
    queryKey: ["patientMessages", patientId, "team"],
    queryFn: () => base44.entities.PatientMessage.filter({ patient_id: patientId, channel: "team" }),
    enabled: !!patientId,
    refetchInterval: 15000,
  });

  const { data: patientMessages = [] } = useQuery({
    queryKey: ["patientMessages", patientId, "patient"],
    queryFn: () => base44.entities.PatientMessage.filter({ patient_id: patientId, channel: "patient" }),
    enabled: !!patientId,
    refetchInterval: 15000,
  });

  const teamUnread = teamMessages.filter(m => 
    m.status === "unread" && m.sender_email !== currentUser?.email
  ).length;
  
  const patientUnread = patientMessages.filter(m => 
    m.status === "unread" && m.sender_email !== currentUser?.email
  ).length;

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          Secure Messaging
          <Badge className="bg-green-100 text-green-700 text-[9px]">
            <Shield className="w-2.5 h-2.5 mr-0.5" /> HIPAA
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pt-2">
        <Tabs defaultValue="team" className="w-full">
          <div className="px-3">
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="team" className="text-xs gap-1 relative">
                <Users className="w-3 h-3" />
                Care Team
                {teamUnread > 0 && (
                  <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 ml-1 rounded-full">
                    {teamUnread}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="patient" className="text-xs gap-1 relative">
                <User className="w-3 h-3" />
                Patient
                {patientUnread > 0 && (
                  <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 ml-1 rounded-full">
                    {patientUnread}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="team" className="mt-0">
            <MessageThread
              patientId={patientId}
              channel="team"
              currentUser={currentUser}
              patientName={patientName}
            />
          </TabsContent>

          <TabsContent value="patient" className="mt-0">
            <MessageThread
              patientId={patientId}
              channel="patient"
              currentUser={currentUser}
              patientName={patientName}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}