import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import AIComplianceInServicesHub from "@/components/training/AIComplianceInServicesHub";
import MyTrainingDashboard from "@/components/training/MyTrainingDashboard";

export default function AIComplianceInServices() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Gate on role === 'admin' to match TrainingCourse RLS (draft reads and all
  // writes are role-admin only). account_type-only admins would otherwise see the
  // management hub but hit an incomplete course list and failing create/publish.
  const isAdmin = currentUser?.role === 'admin';

  // Admins see the full management hub; everyone else sees their in-service
  // training view, which renders its own standard page header.
  return isAdmin ? <AIComplianceInServicesHub /> : (
    <MyTrainingDashboard filterByType="in_service" />
  );
}
