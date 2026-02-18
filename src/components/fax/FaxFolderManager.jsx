import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Folder, Plus, Trash2, Star, Edit2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FOLDER_COLORS = {
  blue: { bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-700", icon: "text-blue-600" },
  green: { bg: "bg-green-50", border: "border-green-300", text: "text-green-700", icon: "text-green-600" },
  purple: { bg: "bg-purple-50", border: "border-purple-300", text: "text-purple-700", icon: "text-purple-600" },
  red: { bg: "bg-red-50", border: "border-red-300", text: "text-red-700", icon: "text-red-600" },
  orange: { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-700", icon: "text-orange-600" },
  yellow: { bg: "bg-yellow-50", border: "border-yellow-300", text: "text-yellow-700", icon: "text-yellow-600" }
};

export default function FaxFolderManager({ userEmail, onFolderSelect }) {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderColor, setFolderColor] = useState("blue");
  const [selectedFolder, setSelectedFolder] = useState(null);

  const { data: folders = [] } = useQuery({
    queryKey: ['faxFolders', userEmail],
    queryFn: () => base44.entities.FaxFolder.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  const { data: faxHistory = [] } = useQuery({
    queryKey: ['faxHistory', userEmail],
    queryFn: () => base44.entities.FaxHistory.filter({ user_email: userEmail }, '-created_date', 200),
    enabled: !!userEmail
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxFolder.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxFolders'] });
      resetForm();
      toast.success("Folder created");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FaxFolder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxFolders'] });
      toast.success("Folder deleted");
    }
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }) => 
      base44.entities.FaxFolder.update(id, { is_favorite: !isFavorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxFolders'] });
    }
  });

  const moveFaxToFolderMutation = useMutation({
    mutationFn: ({ faxId, folderId }) => 
      base44.entities.FaxHistory.update(faxId, { folder_id: folderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxHistory'] });
      toast.success("Fax moved to folder");
    }
  });

  const resetForm = () => {
    setShowCreateDialog(false);
    setFolderName("");
    setFolderColor("blue");
  };

  const handleCreateFolder = () => {
    if (!folderName.trim()) {
      toast.error("Folder name is required");
      return;
    }

    createMutation.mutate({
      user_email: userEmail,
      folder_name: folderName,
      color: folderColor,
      is_favorite: false,
      sort_order: folders.length
    });
  };

  const getFolderFaxCount = (folderId) => {
    return faxHistory.filter(f => f.folder_id === folderId).length;
  };

  const favoriteFolders = folders.filter(f => f.is_favorite);
  const otherFolders = folders.filter(f => !f.is_favorite);

  return (
    <Card>
      <CardHeader className="pb-3 p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            Fax Folders
          </CardTitle>
          <Button size="sm" onClick={() => setShowCreateDialog(true)} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" /> New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-0">
        <div className="space-y-3">
          {/* All Faxes (default) */}
          <button
            onClick={() => {
              setSelectedFolder(null);
              onFolderSelect?.(null);
            }}
            className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-colors ${
              selectedFolder === null ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <FolderOpen className="w-4 h-4 text-slate-600" />
            <span className="flex-1 text-left text-sm font-medium">All Faxes</span>
            <Badge className="bg-slate-100 text-slate-700 text-xs">{faxHistory.length}</Badge>
          </button>

          {/* Favorite Folders */}
          {favoriteFolders.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500 px-1">Favorites</p>
              {favoriteFolders.map(folder => (
                <FolderItem
                  key={folder.id}
                  folder={folder}
                  count={getFolderFaxCount(folder.id)}
                  isSelected={selectedFolder === folder.id}
                  onSelect={() => {
                    setSelectedFolder(folder.id);
                    onFolderSelect?.(folder);
                  }}
                  onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: folder.id, isFavorite: folder.is_favorite })}
                  onDelete={() => {
                    if (confirm(`Delete folder "${folder.folder_name}"? Faxes will not be deleted.`)) {
                      deleteMutation.mutate(folder.id);
                    }
                  }}
                />
              ))}
            </div>
          )}

          {/* Other Folders */}
          {otherFolders.length > 0 && (
            <div className="space-y-1">
              {favoriteFolders.length > 0 && <p className="text-xs font-medium text-slate-500 px-1 pt-2">Folders</p>}
              {otherFolders.map(folder => (
                <FolderItem
                  key={folder.id}
                  folder={folder}
                  count={getFolderFaxCount(folder.id)}
                  isSelected={selectedFolder === folder.id}
                  onSelect={() => {
                    setSelectedFolder(folder.id);
                    onFolderSelect?.(folder);
                  }}
                  onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: folder.id, isFavorite: folder.is_favorite })}
                  onDelete={() => {
                    if (confirm(`Delete folder "${folder.folder_name}"? Faxes will not be deleted.`)) {
                      deleteMutation.mutate(folder.id);
                    }
                  }}
                />
              ))}
            </div>
          )}

          {folders.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-3">No folders yet. Create one to organize your faxes.</p>
          )}
        </div>
      </CardContent>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Folder Name *</Label>
              <Input
                value={folderName}
                onChange={e => setFolderName(e.target.value)}
                placeholder="e.g. Referrals, Lab Results"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Color</Label>
              <div className="flex gap-2">
                {Object.entries(FOLDER_COLORS).map(([color, styles]) => (
                  <button
                    key={color}
                    onClick={() => setFolderColor(color)}
                    className={`w-8 h-8 rounded-lg border-2 transition-all ${styles.bg} ${
                      folderColor === color ? styles.border : 'border-transparent'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetForm} size="sm">Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={createMutation.isPending} size="sm">
              {createMutation.isPending ? "Creating..." : "Create Folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FolderItem({ folder, count, isSelected, onSelect, onToggleFavorite, onDelete }) {
  const colorStyles = FOLDER_COLORS[folder.color] || FOLDER_COLORS.blue;
  
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
      isSelected ? `${colorStyles.bg} ${colorStyles.border}` : 'bg-white border-slate-200 hover:border-slate-300'
    }`}>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={onToggleFavorite}
      >
        <Star className={`w-3.5 h-3.5 ${folder.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-slate-400'}`} />
      </Button>
      <button onClick={onSelect} className="flex-1 flex items-center gap-2 text-left min-w-0">
        <Folder className={`w-4 h-4 flex-shrink-0 ${colorStyles.icon}`} />
        <span className="text-sm font-medium truncate">{folder.folder_name}</span>
      </button>
      <Badge className="bg-slate-100 text-slate-700 text-xs">{count}</Badge>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 text-red-500 hover:text-red-700"
        onClick={onDelete}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}