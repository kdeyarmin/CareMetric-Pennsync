import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Folder, FolderOpen, ChevronRight, ChevronDown, Edit2, Trash2, FolderPlus, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FolderTreeView({ 
  folders = [], 
  selectedFolderId, 
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onChangeColor,
  templatesCount = {}
}) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [colorPickerOpen, setColorPickerOpen] = useState(null);

  const toggleFolder = (folderId) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const startEdit = (folder) => {
    setEditingFolderId(folder.id);
    setEditingName(folder.name);
  };

  const saveEdit = (folderId) => {
    if (editingName.trim()) {
      onRenameFolder(folderId, editingName.trim());
    }
    setEditingFolderId(null);
    setEditingName('');
  };

  const colorOptions = [
    { value: 'gray', class: 'text-slate-600', bg: 'bg-slate-100' },
    { value: 'blue', class: 'text-blue-600', bg: 'bg-blue-100' },
    { value: 'green', class: 'text-green-600', bg: 'bg-green-100' },
    { value: 'purple', class: 'text-navy-600', bg: 'bg-navy-100' },
    { value: 'yellow', class: 'text-yellow-600', bg: 'bg-yellow-100' },
    { value: 'red', class: 'text-red-600', bg: 'bg-red-100' },
    { value: 'indigo', class: 'text-indigo-600', bg: 'bg-indigo-100' },
    { value: 'pink', class: 'text-gold-600', bg: 'bg-gold-100' }
  ];

  const colorClasses = Object.fromEntries(colorOptions.map(c => [c.value, c.class]));

  const buildFolderTree = (parentId = null, depth = 0) => {
    return folders
      .filter(f => f.parent_folder_id === parentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(folder => {
        const isExpanded = expandedFolders.has(folder.id);
        const isSelected = selectedFolderId === folder.id;
        const hasChildren = folders.some(f => f.parent_folder_id === folder.id);
        const count = templatesCount[folder.id] || 0;

        return (
          <div key={folder.id}>
            <div
              className={cn(
                "flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-100 cursor-pointer group transition-colors",
                isSelected && "bg-indigo-50 hover:bg-indigo-100",
                depth > 0 && "ml-4"
              )}
              onClick={() => onSelectFolder(folder.id)}
            >
              {hasChildren && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(folder.id);
                  }}
                  className="p-0.5 hover:bg-slate-200 rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
              )}
              {!hasChildren && <div className="w-4" />}
              
              {isExpanded ? (
                <FolderOpen className={cn("w-4 h-4", colorClasses[folder.color])} />
              ) : (
                <Folder className={cn("w-4 h-4", colorClasses[folder.color])} />
              )}

              {editingFolderId === folder.id ? (
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => saveEdit(folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(folder.id);
                    if (e.key === 'Escape') {
                      setEditingFolderId(null);
                      setEditingName('');
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-6 text-sm flex-1"
                  autoFocus
                />
              ) : (
                <>
                  <span className="text-sm flex-1 truncate">{folder.name}</span>
                  {count > 0 && (
                    <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {count}
                    </span>
                  )}
                </>
              )}

              <div className="opacity-0 group-hover:opacity-100 flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Popover open={colorPickerOpen === folder.id} onOpenChange={(open) => setColorPickerOpen(open ? folder.id : null)}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                    >
                      <Palette className="w-3 h-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" align="start">
                    <div className="grid grid-cols-4 gap-1">
                      {colorOptions.map(color => (
                        <button
                          key={color.value}
                          onClick={() => {
                            onChangeColor(folder.id, color.value);
                            setColorPickerOpen(null);
                          }}
                          className={cn(
                            "w-8 h-8 rounded border-2 hover:scale-110 transition-transform",
                            color.bg,
                            folder.color === color.value && "border-slate-900 scale-110"
                          )}
                          title={color.value}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => startEdit(folder)}
                >
                  <Edit2 className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:text-red-600"
                  onClick={() => onDeleteFolder(folder.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
            {isExpanded && buildFolderTree(folder.id, depth + 1)}
          </div>
        );
      });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700">Folders</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCreateFolder()}
          className="h-7 text-xs"
        >
          <FolderPlus className="w-3 h-3 mr-1" />
          New
        </Button>
      </div>
      
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors",
          selectedFolderId === null && "bg-indigo-50 hover:bg-indigo-100"
        )}
        onClick={() => onSelectFolder(null)}
      >
        <Folder className="w-4 h-4 text-slate-600" />
        <span className="text-sm flex-1">All Templates</span>
        <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
          {templatesCount.uncategorized || 0}
        </span>
      </div>

      {buildFolderTree()}
    </div>
  );
}