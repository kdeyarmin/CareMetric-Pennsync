import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import {
  MessageSquare, Search, Users, User, Shield, Clock,
  AlertTriangle, Loader2, ExternalLink, Filter
} from "lucide-react";

const PRIORITY_COLORS = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

export default function MessagingInbox({ userEmail }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["allMyMessages", userEmail],
    queryFn: () => base44.entities.PatientMessage.list("-created_date", 200),
    enabled: !!userEmail,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
  });

  const patientMap = useMemo(() => {
    const map = {};
    patients.forEach(p => { map[p.id] = p; });
    return map;
  }, [patients]);

  // Group messages by patient + channel into threads
  const threads = useMemo(() => {
    const threadMap = {};
    messages.forEach(msg => {
      const key = `${msg.patient_id}-${msg.channel}`;
      if (!threadMap[key]) {
        threadMap[key] = {
          patient_id: msg.patient_id,
          channel: msg.channel,
          messages: [],
          lastMessage: msg,
          unreadCount: 0,
          hasUrgent: false,
        };
      }
      threadMap[key].messages.push(msg);
      if (msg.status === "unread" && msg.sender_email !== userEmail) {
        threadMap[key].unreadCount++;
      }
      if (msg.priority === "urgent" || msg.priority === "high") {
        threadMap[key].hasUrgent = true;
      }
      if (new Date(msg.created_date) > new Date(threadMap[key].lastMessage.created_date)) {
        threadMap[key].lastMessage = msg;
      }
    });

    return Object.values(threadMap)
      .sort((a, b) => {
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
        if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
        return new Date(b.lastMessage.created_date) - new Date(a.lastMessage.created_date);
      });
  }, [messages, userEmail]);

  const filteredThreads = useMemo(() => {
    return threads.filter(t => {
      const patient = patientMap[t.patient_id];
      const name = patient ? `${patient.first_name} ${patient.last_name}`.toLowerCase() : "";
      const matchSearch = !searchTerm || name.includes(searchTerm.toLowerCase()) ||
        t.lastMessage.body?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchChannel = channelFilter === "all" || t.channel === channelFilter;
      const matchStatus = statusFilter === "all" ||
        (statusFilter === "unread" && t.unreadCount > 0) ||
        (statusFilter === "urgent" && t.hasUrgent);
      return matchSearch && matchChannel && matchStatus;
    });
  }, [threads, searchTerm, channelFilter, statusFilter, patientMap]);

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className="bg-blue-100 text-blue-700 text-xs">
          <MessageSquare className="w-3 h-3 mr-1" /> {threads.length} threads
        </Badge>
        {totalUnread > 0 && (
          <Badge className="bg-red-100 text-red-700 text-xs">
            {totalUnread} unread
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search messages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-[120px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="team">Care Team</SelectItem>
            <SelectItem value="patient">Patient</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[100px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Thread list */}
      {filteredThreads.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No message threads found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredThreads.map(thread => {
            const patient = patientMap[thread.patient_id];
            const patientName = patient ? `${patient.first_name} ${patient.last_name}` : "Unknown Patient";
            const lastMsg = thread.lastMessage;

            return (
              <Link
                key={`${thread.patient_id}-${thread.channel}`}
                to={`${createPageUrl("PatientDetails")}?id=${thread.patient_id}&tab=messaging`}
              >
                <Card className={`hover:shadow-md transition-all cursor-pointer ${
                  thread.unreadCount > 0 ? "border-blue-300 bg-blue-50/40" : ""
                } ${thread.hasUrgent ? "border-l-4 border-l-red-500" : ""}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        thread.channel === "team" ? "bg-blue-100" : "bg-green-100"
                      }`}>
                        {thread.channel === "team"
                          ? <Users className="w-4 h-4 text-blue-600" />
                          : <User className="w-4 h-4 text-green-600" />
                        }
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-slate-800 truncate">{patientName}</p>
                          <Badge className={`text-[9px] px-1.5 py-0 ${
                            thread.channel === "team" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                          }`}>
                            {thread.channel === "team" ? "Team" : "Patient"}
                          </Badge>
                          {lastMsg.priority && lastMsg.priority !== "normal" && (
                            <Badge className={`text-[9px] px-1 py-0 ${PRIORITY_COLORS[lastMsg.priority]}`}>
                              {lastMsg.priority}
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 truncate">
                          <span className="font-medium">{lastMsg.sender_name || lastMsg.sender_email}:</span>{" "}
                          {lastMsg.body?.substring(0, 80)}{lastMsg.body?.length > 80 ? "..." : ""}
                        </p>

                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {lastMsg.created_date ? format(new Date(lastMsg.created_date), "MMM d, h:mm a") : ""}
                          {" · "}{thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}
                        </p>
                      </div>

                      {thread.unreadCount > 0 && (
                        <Badge className="bg-blue-600 text-white text-[10px] rounded-full px-2 py-0.5 flex-shrink-0">
                          {thread.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}