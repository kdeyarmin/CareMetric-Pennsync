import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export function usePermissions() {
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userPermission } = useQuery({
    queryKey: ['userPermission', user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      const perms = await base44.entities.UserPermission.filter({ user_email: user.email });
      return perms && perms.length > 0 ? perms[0] : null;
    },
    enabled: !!user?.email,
  });

  const { data: role } = useQuery({
    queryKey: ['userRole', userPermission?.role_name],
    queryFn: async () => {
      if (!userPermission?.role_name) return null;
      const roles = await base44.entities.Role.filter({ name: userPermission.role_name });
      return roles && roles.length > 0 ? roles[0] : null;
    },
    enabled: !!userPermission?.role_name,
  });

  const hasPermission = (permissionKey) => {
    if (user?.role === 'admin') return true;
    if (!userPermission) return false;

    // Check custom permissions
    if (userPermission.custom_permissions?.includes(permissionKey)) return true;

    // Check role permissions
    if (role?.permissions?.includes(permissionKey)) return true;

    return false;
  };

  const hasModuleAccess = (moduleName) => {
    if (user?.role === 'admin') return true;
    if (!role) return false;

    // Check for module overrides first
    if (userPermission?.module_overrides?.[moduleName] !== undefined) {
      return userPermission.module_overrides[moduleName];
    }

    // Fall back to role module access
    return role.module_access?.[moduleName] ?? false;
  };

  const getAccessibleModules = () => {
    if (user?.role === 'admin') {
      return ['patients', 'visits', 'care_plans', 'tasks', 'training', 'compliance', 'analytics', 'billing', 'admin'];
    }

    if (!role) return [];

    return Object.keys(role.module_access || {}).filter(module => {
      if (userPermission?.module_overrides?.[module] !== undefined) {
        return userPermission.module_overrides[module];
      }
      return role.module_access[module];
    });
  };

  return {
    user,
    userPermission,
    role,
    hasPermission,
    hasModuleAccess,
    getAccessibleModules,
    isAdmin: user?.role === 'admin',
  };
}