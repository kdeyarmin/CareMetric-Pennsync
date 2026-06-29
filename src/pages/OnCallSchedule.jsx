import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import PageHeader from "@/components/ui/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import OnCallCalendar from "@/components/oncall/OnCallCalendar";
import AssignOnCallDialog from "@/components/oncall/AssignOnCallDialog";
import { isSuperAdmin } from "@/lib/superAdmin";

export default function OnCallSchedule() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedSlot, setSelectedSlot] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin(currentUser);

  // Load shifts for the visible month (plus a small buffer for grid spillover).
  const monthKey = format(cursor, "yyyy-MM");
  const { data: shifts = [] } = useQuery({
    queryKey: ["onCallShifts", monthKey],
    queryFn: () => {
      const from = format(startOfMonth(cursor), "yyyy-MM-dd");
      const to = format(endOfMonth(cursor), "yyyy-MM-dd");
      return base44.entities.OnCallShift.filter({
        shift_date: { $gte: from, $lte: to },
      });
    },
    initialData: [],
  });

  // Staff list for the assign dropdown (admins only — User list is admin-scoped).
  const { data: staff = [] } = useQuery({
    queryKey: ["onCallStaff"],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
    enabled: isAdmin,
  });

  const shiftsByDate = useMemo(() => {
    const map = {};
    for (const s of shifts) map[s.shift_date] = s;
    return map;
  }, [shifts]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["onCallShifts"] });

  const handleSave = async ({ slot, assigned_user_email, assigned_user_name, notes }) => {
    const payload = {
      shift_date: slot.iso,
      coverage_type: slot.coverage_type,
      holiday_name: slot.holiday_name || "",
      start_label: slot.start_label,
      end_label: slot.end_label,
      assigned_user_email,
      assigned_user_name,
      notes,
    };
    try {
      if (slot.shift?.id) {
        await base44.entities.OnCallShift.update(slot.shift.id, payload);
      } else {
        await base44.entities.OnCallShift.create(payload);
      }
      toast.success("On-call shift saved");
      refresh();
    } catch (err) {
      toast.error("Could not save shift: " + err.message);
    }
  };

  const handleDelete = async (slot) => {
    try {
      if (slot.shift?.id) await base44.entities.OnCallShift.delete(slot.shift.id);
      toast.success("On-call assignment cleared");
      refresh();
    } catch (err) {
      toast.error("Could not clear shift: " + err.message);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Scheduling"
        title="On-Call Schedule"
        description="Holiday all-day coverage and Monday–Thursday overnight (5pm–9am) on-call assignments."
        favoritePage="OnCallSchedule"
      />

      <EmbeddedPage>
        {!isAdmin && (
          <Alert className="mb-4">
            <AlertDescription>
              You're viewing the on-call schedule. Only administrators can assign or change coverage.
            </AlertDescription>
          </Alert>
        )}

        <OnCallCalendar
          cursor={cursor}
          setCursor={setCursor}
          shiftsByDate={shiftsByDate}
          isAdmin={isAdmin}
          onSelectSlot={setSelectedSlot}
        />

        {isAdmin && (
          <AssignOnCallDialog
            open={!!selectedSlot}
            slot={selectedSlot}
            staff={staff}
            onClose={() => setSelectedSlot(null)}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        )}
      </EmbeddedPage>
    </PageContainer>
  );
}