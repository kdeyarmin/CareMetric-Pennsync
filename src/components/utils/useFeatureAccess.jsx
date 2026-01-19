import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook to check if a feature is enabled for the current user
 * @param {string} featureName - Name of the feature (e.g., 'Telehealth', 'OASIS')
 * @param {object} user - Current user object with role and team_name
 * @returns {boolean} - Whether the feature is enabled
 */
export function useFeatureAccess(featureName, user) {
  const { data: toggles = [] } = useQuery({
    queryKey: ['featureToggles', user?.role],
    queryFn: async () => {
      const results = await base44.entities.FeatureToggle.filter({
        feature_name: featureName,
        role: user?.role || 'user'
      });
      return results;
    },
    enabled: !!user?.role,
    staleTime: 5 * 60 * 1000 // Cache for 5 minutes
  });

  // Check if feature is enabled
  // First check team-specific toggle if user has team
  if (user?.team_name) {
    const teamToggle = toggles.find(t => t.team_name === user.team_name);
    if (teamToggle) return teamToggle.enabled;
  }

  // Fall back to role-wide toggle
  const roleToggle = toggles.find(t => !t.team_name);
  if (roleToggle) return roleToggle.enabled;

  // Default to enabled if no toggle found (feature is available by default)
  return true;
}

/**
 * Check if feature is enabled synchronously (for bulk operations)
 * Use only if you have toggles data already fetched
 */
export function isFeatureEnabled(featureName, user, toggles) {
  if (user?.team_name) {
    const teamToggle = toggles.find(
      t => t.feature_name === featureName && t.team_name === user.team_name
    );
    if (teamToggle) return teamToggle.enabled;
  }

  const roleToggle = toggles.find(
    t => t.feature_name === featureName && t.role === user?.role && !t.team_name
  );
  
  return roleToggle?.enabled ?? true;
}