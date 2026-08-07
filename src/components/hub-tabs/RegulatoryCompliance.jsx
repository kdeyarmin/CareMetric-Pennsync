import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { isAdminLike } from "@/lib/superAdmin";

import RegulatoryMonitor from "@/components/compliance/RegulatoryMonitor";
import NurseRegulatoryAlerts from "@/components/compliance/NurseRegulatoryAlerts";

export default function RegulatoryCompliance() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = isAdminLike(currentUser);

  return (
    <div className="space-y-4 sm:space-y-6">
      {!isAdmin && (
        <NurseRegulatoryAlerts nurseEmail={currentUser?.email} />
      )}

      <RegulatoryMonitor isAdmin={isAdmin} />
    </div>
  );
}