import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ScrollText, Save, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isAdminLike } from "@/lib/superAdmin";

const STATUS_OPTIONS = [
  { value: "not_registered", label: "Not registered" },
  { value: "pending", label: "Pending" },
  { value: "registered", label: "Registered" },
];

const STATUS_BADGE = {
  not_registered: { label: "Not registered", className: "bg-red-100 text-red-800" },
  pending: { label: "Pending", className: "bg-amber-100 text-amber-800" },
  registered: { label: "Registered", className: "bg-green-100 text-green-800" },
};

/**
 * A2PCompliancePanel — admin-only. Explains US A2P 10DLC (Brand + Campaign)
 * registration and stores the agency's registration status + Brand/Campaign ids
 * on AgencySettings. Without an approved 10DLC campaign, US carriers filter or
 * block application-to-person SMS traffic.
 */
export default function A2PCompliancePanel() {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const isAdmin = isAdminLike(currentUser);

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["agency-settings"],
    queryFn: () => base44.entities.AgencySettings.list("-created_date", 1),
    enabled: isAdmin,
    refetchOnWindowFocus: false,
    initialData: [],
  });
  const settings = settingsArr[0];

  const [form, setForm] = useState({
    a2p_10dlc_status: "not_registered",
    a2p_brand_id: "",
    a2p_campaign_id: "",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        a2p_10dlc_status: settings.a2p_10dlc_status || "not_registered",
        a2p_brand_id: settings.a2p_brand_id || "",
        a2p_campaign_id: settings.a2p_campaign_id || "",
      });
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      settings?.id
        ? base44.entities.AgencySettings.update(settings.id, form)
        : base44.entities.AgencySettings.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agency-settings"] });
      toast.success("A2P 10DLC registration saved");
    },
    onError: (err) => toast.error(err?.message || "Failed to save A2P settings"),
  });

  if (!isAdmin) return null;

  const badge = STATUS_BADGE[form.a2p_10dlc_status] || STATUS_BADGE.not_registered;

  return (
    <Card id="a2p-10dlc" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-indigo-600" />
            A2P 10DLC Compliance
          </span>
          <Badge className={badge.className}>{badge.label}</Badge>
        </CardTitle>
        <CardDescription>
          US application-to-person SMS over 10-digit long codes (10DLC) requires registering a
          <strong> Brand</strong> and at least one <strong>Campaign</strong> with The Campaign Registry
          (via your carrier/provider). Until your campaign is approved, carriers throttle, filter, or
          block your texts and you may incur surcharges.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-blue-50 border-blue-200">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-900 text-sm">
            Register your Brand and Campaign in your messaging provider's portal, then record the
            resulting IDs here so the team can confirm the agency is cleared to send. This page tracks
            status only; it does not perform the registration.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-sm font-medium">Registration status</Label>
            <Select
              value={form.a2p_10dlc_status}
              onValueChange={(v) => setForm((f) => ({ ...f, a2p_10dlc_status: v }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium">Brand ID</Label>
            <Input
              placeholder="e.g. BXXXXXX"
              value={form.a2p_brand_id}
              onChange={(e) => setForm((f) => ({ ...f, a2p_brand_id: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Campaign ID</Label>
            <Input
              placeholder="e.g. CXXXXXX"
              value={form.a2p_campaign_id}
              onChange={(e) => setForm((f) => ({ ...f, a2p_campaign_id: e.target.value }))}
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save A2P Registration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
