import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, Plus, Trash2, Code, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function DocumentEmbedGenerator({ documentId, documentTitle }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [domain, setDomain] = useState("");
  const [embedSettings, setEmbedSettings] = useState({
    show_signature_fields: false,
    show_metadata: false,
    allow_download: false,
    allow_print: false,
    width: "100%",
    height: "600px",
  });

  const { data: embeds = [] } = useQuery({
    queryKey: ["embedConfigs", documentId],
    queryFn: () =>
      base44.entities.EmbedConfig.filter({
        document_id: documentId,
      }),
  });

  const createEmbedMutation = useMutation({
    mutationFn: async () => {
      const token = Math.random().toString(36).substring(2, 15) + 
                    Math.random().toString(36).substring(2, 15);
      return base44.entities.EmbedConfig.create({
        document_id: documentId,
        embed_token: token,
        allowed_domains: [domain],
        title: documentTitle,
        ...embedSettings,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedConfigs", documentId] });
      toast.success("Embed created successfully");
      setDomain("");
      setShowForm(false);
    },
    onError: () => toast.error("Failed to create embed"),
  });

  const deleteEmbedMutation = useMutation({
    mutationFn: (id) => base44.entities.EmbedConfig.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedConfigs", documentId] });
      toast.success("Embed deleted");
    },
    onError: () => toast.error("Failed to delete embed"),
  });

  const copyEmbedCode = (embed) => {
    const embedCode = `<iframe src="https://app.caremetricai.com/embed/${embed.embed_token}" width="${embed.width}" height="${embed.height}" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(embedCode);
    toast.success("Embed code copied to clipboard");
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Code className="w-5 h-5" />
          Embed Settings
        </h3>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Create Embed
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Domain to Allow *
              </label>
              <Input
                placeholder="example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the domain where this document will be embedded
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Width</label>
                <Input
                  value={embedSettings.width}
                  onChange={(e) =>
                    setEmbedSettings({
                      ...embedSettings,
                      width: e.target.value,
                    })
                  }
                  placeholder="100%"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Height</label>
                <Input
                  value={embedSettings.height}
                  onChange={(e) =>
                    setEmbedSettings({
                      ...embedSettings,
                      height: e.target.value,
                    })
                  }
                  placeholder="600px"
                />
              </div>
            </div>

            <div className="space-y-2">
              {["show_signature_fields", "show_metadata", "allow_download", "allow_print"].map(
                (key) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={embedSettings[key]}
                      onChange={(e) =>
                        setEmbedSettings({
                          ...embedSettings,
                          [key]: e.target.checked,
                        })
                      }
                    />
                    <span className="text-sm">
                      {key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
                    </span>
                  </label>
                )
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => createEmbedMutation.mutate()}
                disabled={!domain || createEmbedMutation.isPending}
              >
                Create Embed
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {embeds.length === 0 ? (
          <p className="text-sm text-gray-500">No embeds created yet</p>
        ) : (
          embeds.map((embed) => (
            <Card key={embed.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-xs">
                        {embed.allowed_domains.join(", ")}
                      </Badge>
                      <Badge
                        className={`text-xs ${
                          embed.status === "active"
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {embed.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-500">
                      Token: {embed.embed_token.substring(0, 12)}...
                    </p>
                    {embed.view_count > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        Views: {embed.view_count}
                        {embed.max_views && ` / ${embed.max_views}`}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyEmbedCode(embed)}
                      className="gap-1"
                    >
                      <Copy className="w-4 h-4" />
                      Copy Code
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.confirm("Delete this embed?") &&
                        deleteEmbedMutation.mutate(embed.id)
                      }
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}