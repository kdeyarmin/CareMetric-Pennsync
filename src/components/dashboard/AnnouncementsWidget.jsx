import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell } from "lucide-react";
import { format } from "date-fns";

export default function AnnouncementsWidget() {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const result = await base44.entities.Announcement.filter({ is_active: true });
      return result || [];
    },
    initialData: [],
    refetchOnMount: true,
    refetchOnWindowFocus: false
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            Announcements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">Loading...</p>
        </CardContent>
      </Card>);

  }

  if (announcements.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent className="bg-gray-200 text-neutral-950 p-4">
          <p className="text-sm text-gray-500 text-center">No announcements at this time.</p>
        </CardContent>
      </Card>);

  }

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="pb-3 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-600" />
          Announcements
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <ScrollArea className="h-[200px] pr-3">
          <div className="space-y-3">
            {announcements.map((announcement) =>
            <div
              key={announcement.id}
              className={`p-3 rounded-lg border-l-4 ${
              announcement.type === 'urgent' ? 'border-l-red-500 bg-red-50' :
              announcement.type === 'success' ? 'border-l-green-500 bg-green-50' :
              announcement.type === 'warning' ? 'border-l-yellow-500 bg-yellow-50' :
              'border-l-blue-500 bg-blue-50'}`
              }>

                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 text-sm">{announcement.title}</h4>
                    <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{announcement.content}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      {format(new Date(announcement.created_date), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>);

}