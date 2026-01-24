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

  // Get role-specific feature access
  const { data: roleFeatures } = useQuery({
    queryKey: ['roleFeatures', currentUser?.agency_code, currentUser?.credential_type],
    queryFn: async () => {
      if (!currentUser?.agency_code || !currentUser?.credential_type) return null;
      
      // First try to get provider-specific rules
      const providerRules = await base44.entities.AgencyFeatureAccess.filter({
        agency_code: currentUser.agency_code,
        provider_type: currentUser.credential_type
      });
      
      if (providerRules.length > 0) {
        return providerRules[0];
      }
      
      // Fall back to "all" provider type
      const allRules = await base44.entities.AgencyFeatureAccess.filter({
        agency_code: currentUser.agency_code,
        provider_type: "all"
      });
      
      return allRules.length > 0 ? allRules[0] : null;
    },
    enabled: !!currentUser?.agency_code && !!currentUser?.credential_type
  });

  const hasFeatureAccess = (featurePage) => {
    // If not in an agency, allow all features
    if (!currentUser?.agency_code || !agency) return true;
    
    // Check role-specific restrictions first
    if (roleFeatures) {
      return roleFeatures.enabled_features?.includes(featurePage) || false;
    }
    
    // Fall back to agency-wide enabled features
    return agency.enabled_features?.includes(featurePage) || false;
  };

  return {
    agency,
    roleFeatures,
    hasFeatureAccess,
    enabledFeatures: roleFeatures?.enabled_features || agency?.enabled_features || []
  };
}