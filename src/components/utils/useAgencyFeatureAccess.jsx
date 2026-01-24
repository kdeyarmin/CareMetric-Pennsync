import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export function useAgencyFeatureAccess(currentUser) {
  const { data: agency } = useQuery({
    queryKey: ['userAgency', currentUser?.agency_code],
    queryFn: async () => {
      if (!currentUser?.agency_code) return null;
      const agencies = await base44.entities.Agency.filter({ 
        agency_code: currentUser.agency_code 
      });
      return agencies[0];
    },
    enabled: !!currentUser?.agency_code
  });

  const hasFeatureAccess = (featurePage) => {
    // If not in an agency, allow all features
    if (!currentUser?.agency_code || !agency) return true;
    
    // Check if feature is in agency's enabled list
    return agency.enabled_features?.includes(featurePage) || false;
  };

  return {
    agency,
    hasFeatureAccess,
    enabledFeatures: agency?.enabled_features || []
  };
}