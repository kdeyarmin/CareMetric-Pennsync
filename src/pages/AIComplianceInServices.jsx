import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import AIComplianceInServicesHub from "@/components/training/AIComplianceInServicesHub";
import MyTrainingDashboard from "@/components/training/MyTrainingDashboard";

export default function AIComplianceInServices() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  // Admins see the full management hub; everyone else sees their in-service
  // training view, which renders its own standard page header.
  return isAdmin ? <AIComplianceInServicesHub /> : (
    <MyTrainingDashboard filterByType="in_service" />
  );
}
