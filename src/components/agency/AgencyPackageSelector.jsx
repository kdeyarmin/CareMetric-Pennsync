import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Package, DollarSign, Users } from "lucide-react";

export default function AgencyPackageSelector({ agency }) {
  const queryClient = useQueryClient();

  const { data: packages = [] } = useQuery({
    queryKey: ['featurePackages'],
    queryFn: () => base44.entities.FeaturePackage.filter({ is_active: true })
  });

  const updateAgencyMutation = useMutation({
    mutationFn: (data) => base44.entities.Agency.update(agency.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['myAgency']);
      toast.success('Package updated successfully');
    }
  });

  const handleSelectPackage = (pkg) => {
    updateAgencyMutation.mutate({
      price_per_user: pkg.price_per_user,
      enabled_features: pkg.included_features,
      package_tier: pkg.tier,
      package_name: pkg.package_name
    });
  };

  const currentPackageName = agency.package_name || 'Custom';

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Select Feature Package</h3>
        <p className="text-sm text-slate-600">
          Choose a package that fits your agency's needs. Your billing will adjust automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {packages.map((pkg) => {
          const isCurrent = pkg.package_name === currentPackageName;
          
          return (
            <Card
              key={pkg.id}
              className={`relative ${
                isCurrent ? 'border-2 border-blue-500 shadow-lg' : 'hover:shadow-lg'
              } transition-all`}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-blue-600">Current Plan</Badge>
                </div>
              )}

              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-5 h-5 text-blue-600" />
                  <CardTitle className="text-lg">{pkg.package_name}</CardTitle>
                </div>
                <Badge variant="outline" className="w-fit capitalize">
                  {pkg.tier}
                </Badge>
                <CardDescription className="mt-2">{pkg.description}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
                  <div className="flex items-baseline justify-center gap-1">
                    <DollarSign className="w-5 h-5 text-blue-700" />
                    <span className="text-3xl font-bold text-blue-900">{pkg.price_per_user}</span>
                    <span className="text-slate-600">/user/mo</span>
                  </div>
                  {pkg.max_users && (
                    <p className="text-xs text-slate-600 mt-2 flex items-center justify-center gap-1">
                      <Users className="w-3 h-3" />
                      Up to {pkg.max_users} users
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-2">What's Included:</p>
                  <div className="space-y-2">
                    {pkg.features_summary?.ai_tools && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-600" />
                        <span>AI-Powered Tools</span>
                      </div>
                    )}
                    {pkg.features_summary?.advanced_analytics && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-600" />
                        <span>Advanced Analytics</span>
                      </div>
                    )}
                    {pkg.features_summary?.custom_training && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-600" />
                        <span>Custom Training</span>
                      </div>
                    )}
                    {pkg.features_summary?.api_access && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-600" />
                        <span>API Access</span>
                      </div>
                    )}
                    {pkg.features_summary?.dedicated_support && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-600" />
                        <span>Dedicated Support</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-600" />
                      <span>{pkg.included_features?.length || 0} Features</span>
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full"
                  variant={isCurrent ? 'outline' : 'default'}
                  disabled={isCurrent || updateAgencyMutation.isPending}
                  onClick={() => handleSelectPackage(pkg)}
                >
                  {isCurrent ? 'Current Plan' : 'Select This Plan'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {packages.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">No packages available yet</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}