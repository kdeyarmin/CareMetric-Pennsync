import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PersonnelCredentialForm from "@/components/personnel/PersonnelCredentialForm";
import PersonnelStatusBadge from "@/components/personnel/PersonnelStatusBadge";
import CredentialRenewalPortal from "@/components/personnel/CredentialRenewalPortal";
import AdminCredentialApproval from "@/components/personnel/AdminCredentialApproval";
import CredentialComplianceReport from "@/components/admin/CredentialComplianceReport";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import { FolderOpen, Users } from "lucide-react";
import { isSafeExternalUrl } from "@/components/utils/security";
import { formatLocalDate } from "@/lib/dateLocal";
import { isAdminView } from "@/lib/roles";
import { isAdminLike } from "@/lib/superAdmin";
import { openAuthorityBoundWindow } from "@/lib/authorityBoundWindows";

export default function PersonnelFile() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: items = [] } = useQuery({ queryKey: ["personnel-credentials"], queryFn: () => base44.entities.PersonnelCredential.list('-expiration_date', 500), initialData: [] });
  const adminView = isAdminView(currentUser);
  // Other-user credential reads and review mutations require the protected
  // built-in admin role. Personal file and renewal workflows remain available.
  const canReviewPersonnel = isAdminLike(currentUser);

  const myItems = useMemo(() => items.filter((item) => item.user_id === currentUser?.email), [items, currentUser]);
  const pendingApprovals = useMemo(() => {
    if (!canReviewPersonnel) return [];
    return items.filter((item) => item.status === 'pending_approval' && (!currentUser?.agency_name || item.agency_name === currentUser.agency_name));
  }, [items, currentUser, canReviewPersonnel]);

  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        eyebrow="Manage"
        title="Personnel File"
        description="Track expiring licenses, certifications, and insurance documents, upload renewals, and manage agency approval."
        favoritePage="PersonnelFile"
      />

      {adminView && !canReviewPersonnel && (
        <Card className="mb-4 border-blue-200 bg-blue-50">
          <CardContent className="p-4 text-sm text-blue-900">
            Your personnel file and renewal tools remain available. Agency-wide approvals and expiration tracking require protected administrator access until credential reviews use immutable tenant-membership authorization.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="my-file" className="space-y-6">
        <TabsList>
          <TabsTrigger value="my-file">My Personnel File</TabsTrigger>
          <TabsTrigger value="renewals">Renewals</TabsTrigger>
          {canReviewPersonnel && <TabsTrigger value="approvals">Approvals ({pendingApprovals.length})</TabsTrigger>}
          {canReviewPersonnel && <TabsTrigger value="tracking">Expiration Tracking</TabsTrigger>}
        </TabsList>

        <TabsContent value="my-file" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingItem(null); setShowForm((value) => !value); }}>
              {showForm ? 'Close Form' : 'Add Personnel File Item'}
            </Button>
          </div>

          {showForm && currentUser && (
            <Card>
              <CardHeader><CardTitle>{editingItem ? 'Update Personnel File Item' : 'Add Personnel File Item'}</CardTitle></CardHeader>
              <CardContent>
                {/* Keyed on the target item: the form seeds its fields from
                    `existingItem` once. "Upload New Copy" sets editingItem
                    while the form is already open, so without a remount the
                    fields kept the previous (or blank) item's values and the
                    save wrote those onto the newly targeted credential. */}
                <PersonnelCredentialForm key={editingItem?.id || 'new'} currentUser={currentUser} existingItem={editingItem} onDone={() => { setShowForm(false); setEditingItem(null); }} />
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            {myItems.length === 0 ? (
              <EmptyState icon={FolderOpen} title="No personnel file items added yet." description="" />
            ) : (
              myItems.map((item) => (
                <Card key={item.id}>
                  <CardContent className="p-5 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <h3 className="font-semibold text-slate-900">{item.title}</h3>
                        <PersonnelStatusBadge status={item.status} />
                      </div>
                      <p className="text-sm text-slate-500">{item.item_type} • expires {formatLocalDate(item.expiration_date)}</p>
                      {item.issuing_organization && <p className="text-sm text-slate-500">{item.issuing_organization}</p>}
                      {item.uploaded_file_url && isSafeExternalUrl(item.uploaded_file_url) && (
                        <button
                          type="button"
                          onClick={() => openAuthorityBoundWindow(item.uploaded_file_url)}
                          className="text-sm text-indigo-600 underline hover:text-indigo-700"
                        >
                          Open uploaded document
                        </button>
                      )}
                      {item.rejection_reason && <p className="text-sm text-red-600 mt-2">Rejection reason: {item.rejection_reason}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => { setEditingItem(item); setShowForm(true); }}>Upload New Copy</Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="renewals">
          <CredentialRenewalPortal userId={currentUser?.email} />
        </TabsContent>

        {canReviewPersonnel && (
          <TabsContent value="approvals">
            <AdminCredentialApproval />
          </TabsContent>
        )}

        {canReviewPersonnel && (
          <TabsContent value="tracking">
            <CredentialComplianceReport />
          </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  );
}
