import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Mail, Megaphone } from "lucide-react";
import NotificationPreferences from "../components/notifications/NotificationPreferences";
import AnnouncementManager from "../components/admin/AnnouncementManager";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { isAdminView } from "@/lib/roles";
import { isAdminLike } from "@/lib/superAdmin";

export default function NotificationSettings() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const adminView = isAdminView(currentUser);
  // Announcement CRUD is protected by Announcement RLS role === 'admin'.
  const canManageAnnouncements = isAdminLike(currentUser);

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
          <TabsList className={`grid ${canManageAnnouncements ? 'grid-cols-2' : 'grid-cols-1'} w-full max-w-md`}>
            <TabsTrigger value="preferences" className="gap-2">
              <Mail className="w-4 h-4" />
              Email Preferences
            </TabsTrigger>
            {canManageAnnouncements && (
              <TabsTrigger value="announcements" className="gap-2">
                <Megaphone className="w-4 h-4" />
                Announcements
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="preferences">
            <NotificationPreferences currentUser={currentUser} />
          </TabsContent>

          {canManageAnnouncements && (
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

          {adminView && !canManageAnnouncements && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-4 text-sm text-blue-900">
                System-wide announcement management requires protected administrator access. Your personal notification preferences remain available.
              </CardContent>
            </Card>
          )}
        </Tabs>
    </PageContainer>
  );
}
