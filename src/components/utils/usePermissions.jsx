import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export function usePermissions() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: Infinity,
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => base44.entities.Role.list(),
    staleTime: Infinity,
  });

  const can = (permission) => {
    if (!currentUser || !roles) return false;
    
    // Platform admin has all permissions
    if (currentUser.role === 'admin') return true;

    const userRoleName = currentUser.app_role;
    if (!userRoleName) return false;

    const userRole = roles.find(r => r.name === userRoleName);
    if (!userRole) return false;

    return userRole.permissions?.includes(permission);
  };
  
  const hasRole = (roleName) => {
    if (!currentUser) return false;
    return currentUser.app_role === roleName;
  }

  return { currentUser, can, hasRole };
}