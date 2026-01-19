import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Shield, Settings } from "lucide-react";
import { toast } from "sonner";

export default function EmbedPermissionsManager({ embedId }) {
  const queryClient = useQueryClient();
  const [newDomain, setNewDomain] = useState("");
  const [showAddDomain, setShowAddDomain] = useState(false);

  const { data: embed } = useQuery({
    queryKey: ["embedConfig", embedId],
    queryFn: () => base44.entities.EmbedConfig.filter({ id: embedId }),
  });

  const currentEmbed = embed?.[0];

  const addDomainMutation = useMutation({
    mutationFn: async () => {
      if (!currentEmbed) return;
      const updatedDomains = [...(currentEmbed.allowed_domains || []), newDomain];
      return base44.entities.EmbedConfig.update(embedId, {
        allowed_domains: updatedDomains,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedConfig", embedId] });
      toast.success("Domain added");
      setNewDomain("");
      setShowAddDomain(false);
    },
    onError: () => toast.error("Failed to add domain"),
  });

  const removeDomainMutation = useMutation({
    mutationFn: async (domain) => {
      if (!currentEmbed) return;
      const updatedDomains = currentEmbed.allowed_domains.filter(
        (d) => d !== domain
      );
      return base44.entities.EmbedConfig.update(embedId, {
        allowed_domains: updatedDomains,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedConfig", embedId] });
      toast.success("Domain removed");
    },
    onError: () => toast.error("Failed to remove domain"),
  });

  const togglePermissionMutation = useMutation({
    mutationFn: async (permissionKey) => {
      if (!currentEmbed) return;
      return base44.entities.EmbedConfig.update(embedId, {
        [permissionKey]: !currentEmbed[permissionKey],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedConfig", embedId] });
      toast.success("Permission updated");
    },
    onError: () => toast.error("Failed to update permission"),
  });

  if (!currentEmbed) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Allowed Domains */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Allowed Domains
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {currentEmbed.allowed_domains?.map((domain) => (
              <div
                key={domain}
                className="flex items-center justify-between p-2 bg-gray-50 rounded"
              >
                <span className="text-sm font-mono">{domain}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeDomainMutation.mutate(domain)}
                  disabled={removeDomainMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>

          {showAddDomain ? (
            <div className="flex gap-2">
              <Input
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
              <Button
                onClick={() => addDomainMutation.mutate()}
                disabled={!newDomain || addDomainMutation.isPending}
                size="sm"
              >
                Add
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddDomain(false)}
                size="sm"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setShowAddDomain(true)}
              variant="outline"
              className="w-full gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Domain
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Permissions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Embed Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                key: "show_signature_fields",
                label: "Show Signature Fields",
              },
              { key: "show_metadata", label: "Show Metadata" },
              { key: "allow_download", label: "Allow Download" },
              { key: "allow_print", label: "Allow Print" },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={currentEmbed[key] || false}
                  onChange={() => togglePermissionMutation.mutate(key)}
                  disabled={togglePermissionMutation.isPending}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">{label}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Usage Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Max Views (leave empty for unlimited)
            </label>
            <Input
              type="number"
              placeholder="e.g., 100"
              value={currentEmbed.max_views || ""}
              onChange={(e) => {
                base44.entities.EmbedConfig.update(embedId, {
                  max_views: e.target.value ? parseInt(e.target.value) : null,
                });
              }}
            />
          </div>

          {currentEmbed.view_count > 0 && (
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm">
                <span className="font-semibold">Current Views:</span>{" "}
                {currentEmbed.view_count}
                {currentEmbed.max_views &&
                  ` / ${currentEmbed.max_views} (${Math.round(
                    (currentEmbed.view_count / currentEmbed.max_views) * 100
                  )}%)`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}