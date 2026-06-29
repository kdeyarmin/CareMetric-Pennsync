import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Upload,
  FileCheck,
  Clock,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { validateFileUpload } from "@/components/utils/security";
import { format, parseISO, differenceInDays, addMonths } from "date-fns";

export default function CredentialRenewalPortal({ userId }) {
  const [selectedCredential, setSelectedCredential] = useState(null);
  const [_showUploadDialog, setShowUploadDialog] = useState(false);
  const [renewalData, setRenewalData] = useState({
    uploaded_file_url: "",
    uploaded_file_name: "",
    issued_date: "",
    expiration_date: "",
    credential_number: ""
  });
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const targetUserId = userId || currentUser?.email;

  const { data: credentials = [] } = useQuery({
    queryKey: ['userCredentials', targetUserId],
    queryFn: () => base44.entities.PersonnelCredential.filter({ user_id: targetUserId }),
    enabled: !!targetUserId,
    initialData: [],
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const check = validateFileUpload(file, {
      maxSize: 15 * 1024 * 1024,
      allowedTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg'],
    });
    if (!check.valid) { toast.error(check.error); return; }

    setUploading(true);
    try {
      const result = await base44.integrations.Core.UploadFile({ file });
      
      setRenewalData(prev => ({
        ...prev,
        uploaded_file_url: result.file_url,
        uploaded_file_name: file.name
      }));
      
      toast.success("File uploaded successfully");
    } catch {
      toast.error("Failed to upload file");
    }
    setUploading(false);
  };

  const submitRenewalMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCredential || !renewalData.uploaded_file_url) {
        throw new Error("Missing required data");
      }

      // Create new credential record for renewal (pending approval)
      await base44.entities.PersonnelCredential.create({
        user_id: selectedCredential.user_id,
        user_name: selectedCredential.user_name,
        agency_name: selectedCredential.agency_name,
        item_type: selectedCredential.item_type,
        title: selectedCredential.title,
        issuing_organization: selectedCredential.issuing_organization,
        credential_number: renewalData.credential_number || selectedCredential.credential_number,
        issued_date: renewalData.issued_date,
        expiration_date: renewalData.expiration_date,
        uploaded_file_url: renewalData.uploaded_file_url,
        uploaded_file_name: renewalData.uploaded_file_name,
        notes: `Renewal submission for credential ID: ${selectedCredential.id}`,
        status: 'pending_approval'
      });

      // Update old credential to show renewal submitted
      await base44.entities.PersonnelCredential.update(selectedCredential.id, {
        notes: (selectedCredential.notes || '') + `\n[Renewal submitted on ${format(new Date(), 'yyyy-MM-dd')}]`
      });

      // Notify admins
      const admins = await base44.entities.User.filter({ role: 'admin' });
      await Promise.all(
        admins.map(admin =>
          base44.integrations.Core.SendEmail({
            to: admin.email,
            subject: `📋 Credential Renewal Submitted - ${selectedCredential.title}`,
            body: `A credential renewal has been submitted for approval:

Employee: ${selectedCredential.user_name}
Credential: ${selectedCredential.title}
Type: ${selectedCredential.item_type}
New Expiration: ${format(parseISO(renewalData.expiration_date), 'MMM d, yyyy')}

Please review and approve in the Personnel File dashboard.`
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userCredentials'] });
      setShowUploadDialog(false);
      setSelectedCredential(null);
      setRenewalData({
        uploaded_file_url: "",
        uploaded_file_name: "",
        issued_date: "",
        expiration_date: "",
        credential_number: ""
      });
      toast.success("Renewal submitted for admin approval");
    },
    onError: () => {
      toast.error("Failed to submit renewal");
    }
  });

  const handleSubmitRenewal = (e) => {
    e.preventDefault();
    submitRenewalMutation.mutate();
  };

  const today = new Date();

  const expiringCredentials = credentials.filter(cred => {
    if (!cred.expiration_date || cred.status === 'expired') return false;
    const expDate = parseISO(cred.expiration_date);
    const daysUntil = differenceInDays(expDate, today);
    return daysUntil <= 90 && daysUntil >= 0;
  }).sort((a, b) => new Date(a.expiration_date) - new Date(b.expiration_date));

  const expiredCredentials = credentials.filter(cred => {
    // A pending_approval record is a renewal-in-flight (typically with a future
    // expiration), not a credential the user needs to re-renew — exclude it so it
    // never surfaces as "Expired / Renew Now".
    if (!cred.expiration_date || cred.status === 'pending_approval') return false;
    const expDate = parseISO(cred.expiration_date);
    return expDate < today;
  });

  const pendingRenewals = credentials.filter(cred => cred.status === 'pending_approval');

  const getUrgencyColor = (daysUntil) => {
    if (daysUntil <= 0) return 'bg-red-600 text-white';
    if (daysUntil <= 7) return 'bg-orange-500 text-white';
    if (daysUntil <= 30) return 'bg-yellow-500 text-white';
    return 'bg-blue-500 text-white';
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white border-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="w-8 h-8 text-red-200" />
            </div>
            <p className="text-2xl font-bold">{expiredCredentials.length}</p>
            <p className="text-xs text-red-100">Expired</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-8 h-8 text-orange-200" />
            </div>
            <p className="text-2xl font-bold">{expiringCredentials.length}</p>
            <p className="text-xs text-orange-100">Expiring Soon</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <FileCheck className="w-8 h-8 text-blue-200" />
            </div>
            <p className="text-2xl font-bold">{pendingRenewals.length}</p>
            <p className="text-xs text-blue-100">Pending Approval</p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Renewals */}
      {pendingRenewals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              Pending Approvals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingRenewals.map(cred => (
                <div key={cred.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div>
                    <h4 className="font-semibold text-slate-900">{cred.title}</h4>
                    <p className="text-sm text-slate-600">Submitted {format(parseISO(cred.created_date), 'MMM d, yyyy')}</p>
                  </div>
                  <Badge className="bg-blue-600">Pending Approval</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expiring Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Credentials Requiring Renewal
          </CardTitle>
        </CardHeader>
        <CardContent>
          {expiringCredentials.length === 0 && expiredCredentials.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
              <p>All credentials are current</p>
            </div>
          ) : (
            <div className="space-y-3">
              {expiredCredentials.map(cred => {
                const daysOverdue = Math.abs(differenceInDays(today, parseISO(cred.expiration_date)));
                
                return (
                  <div key={cred.id} className="border-l-4 border-l-red-600 bg-red-50 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-slate-900">{cred.title}</h4>
                          <Badge className="bg-red-600">EXPIRED</Badge>
                        </div>
                        <p className="text-sm text-slate-600 mb-1">
                          {cred.issuing_organization} • {cred.item_type}
                        </p>
                        <p className="text-sm text-red-700 font-medium">
                          Expired {daysOverdue} days ago on {format(parseISO(cred.expiration_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => setSelectedCredential(cred)}
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            Renew Now
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Submit Renewal: {cred.title}</DialogTitle>
                          </DialogHeader>
                          <form onSubmit={handleSubmitRenewal} className="space-y-4">
                            <div>
                              <Label>Upload Renewed Document *</Label>
                              <div className="mt-2">
                                <label className="flex items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-slate-400 transition-colors">
                                  <div className="text-center">
                                    <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                                    <span className="text-sm text-slate-600">
                                      {uploading ? "Uploading..." : renewalData.uploaded_file_name || "Click to upload"}
                                    </span>
                                  </div>
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="hidden"
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                  />
                                </label>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label>New Issue Date *</Label>
                                <Input
                                  type="date"
                                  value={renewalData.issued_date}
                                  onChange={(e) => setRenewalData({ ...renewalData, issued_date: e.target.value })}
                                  required
                                />
                              </div>
                              <div>
                                <Label>New Expiration Date *</Label>
                                <Input
                                  type="date"
                                  value={renewalData.expiration_date}
                                  onChange={(e) => setRenewalData({ ...renewalData, expiration_date: e.target.value })}
                                  required
                                />
                              </div>
                            </div>

                            <div>
                              <Label>Credential Number (if changed)</Label>
                              <Input
                                value={renewalData.credential_number}
                                onChange={(e) => setRenewalData({ ...renewalData, credential_number: e.target.value })}
                                placeholder={cred.credential_number || "Enter new number"}
                              />
                            </div>

                            <div className="flex gap-2 pt-4">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setShowUploadDialog(false)}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="submit"
                                disabled={!renewalData.uploaded_file_url || submitRenewalMutation.isPending}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <FileCheck className="w-4 h-4 mr-2" />
                                Submit for Approval
                              </Button>
                            </div>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                );
              })}

              {expiringCredentials.map(cred => {
                const daysUntil = differenceInDays(parseISO(cred.expiration_date), today);
                
                return (
                  <div key={cred.id} className={`border-l-4 rounded-lg p-4 ${daysUntil <= 7 ? 'border-l-red-500 bg-red-50' : daysUntil <= 30 ? 'border-l-orange-500 bg-orange-50' : 'border-l-yellow-500 bg-yellow-50'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-slate-900">{cred.title}</h4>
                          <Badge className={getUrgencyColor(daysUntil)}>
                            {daysUntil} days
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 mb-1">
                          {cred.issuing_organization} • {cred.item_type}
                        </p>
                        <p className="text-sm text-slate-700">
                          Expires: {format(parseISO(cred.expiration_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedCredential(cred);
                              setRenewalData({
                                uploaded_file_url: "",
                                uploaded_file_name: "",
                                issued_date: format(new Date(), 'yyyy-MM-dd'),
                                expiration_date: format(addMonths(new Date(), 12), 'yyyy-MM-dd'),
                                credential_number: ""
                              });
                            }}
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            Upload Renewal
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Submit Renewal: {cred.title}</DialogTitle>
                          </DialogHeader>
                          <form onSubmit={handleSubmitRenewal} className="space-y-4">
                            <div>
                              <Label>Upload Renewed Document *</Label>
                              <div className="mt-2">
                                <label className="flex items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-slate-400 transition-colors">
                                  <div className="text-center">
                                    <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                                    <span className="text-sm text-slate-600">
                                      {uploading ? "Uploading..." : renewalData.uploaded_file_name || "Click to upload PDF or image"}
                                    </span>
                                  </div>
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="hidden"
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                  />
                                </label>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label>New Issue Date *</Label>
                                <Input
                                  type="date"
                                  value={renewalData.issued_date}
                                  onChange={(e) => setRenewalData({ ...renewalData, issued_date: e.target.value })}
                                  required
                                />
                              </div>
                              <div>
                                <Label>New Expiration Date *</Label>
                                <Input
                                  type="date"
                                  value={renewalData.expiration_date}
                                  onChange={(e) => setRenewalData({ ...renewalData, expiration_date: e.target.value })}
                                  required
                                />
                              </div>
                            </div>

                            <div>
                              <Label>Credential Number</Label>
                              <Input
                                value={renewalData.credential_number}
                                onChange={(e) => setRenewalData({ ...renewalData, credential_number: e.target.value })}
                                placeholder={cred.credential_number || "Enter credential number"}
                              />
                            </div>

                            <div className="flex gap-2 pt-4">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setShowUploadDialog(false)}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="submit"
                                disabled={!renewalData.uploaded_file_url || submitRenewalMutation.isPending}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <FileCheck className="w-4 h-4 mr-2" />
                                {submitRenewalMutation.isPending ? "Submitting..." : "Submit for Approval"}
                              </Button>
                            </div>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}