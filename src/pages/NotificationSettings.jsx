import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Mail, Megaphone } from "lucide-react";
import NotificationPreferences from "../components/notifications/NotificationPreferences";
import AnnouncementManager from "../components/admin/AnnouncementManager";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function NotificationSettings() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  return (
    <PageContainer>
      <PageHeader
        icon={Bell}
        eyebrow="Tools"
        title="Notification Settings"
        description="Manage your notification preferences"
        favoritePage="NotificationSettings"
      />

        <Tabs defaultValue="preferences" className="space-y-6">
          <TabsList className={`grid ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'} w-full max-w-md`}>
            <TabsTrigger value="preferences" className="gap-2">
              <Mail className="w-4 h-4" />
              Email Preferences
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="announcements" className="gap-2">
                <Megaphone className="w-4 h-4" />
                Announcements
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="preferences">
            <NotificationPreferences currentUser={currentUser} />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="announcements">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Megaphone className="w-5 h-5" />
                    System-Wide Announcements
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <AnnouncementManager />
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
    </PageContainer>
  );
}