import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Bell, Plus, Edit2, Trash2, Eye, EyeOff, Search, Clock, Calendar as CalendarIcon, Filter } from "lucide-react";
import { format } from "date-fns";
import { formatEastern } from "@/components/utils/timezone";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AnnouncementManager() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [announcementToDelete, setAnnouncementToDelete] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    is_active: true,
    scheduled_for: null,
    expires_at: null
  });

  const { data: announcements = [], isLoading, refetch } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      try {
        const result = await base44.entities.Announcement.list('-created_date');
        return result || [];
      } catch (error) {
        console.error('❌ Error fetching announcements:', error);
        toast.error(`Error loading announcements: ${error.message}`);
        return [];
      }
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    staleTime: 0
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const result = await base44.entities.Announcement.create(data);
      return result;
    },
    onSuccess: async (_data) => {
      await queryClient.invalidateQueries({ queryKey: ['announcements'] });
      await refetch();
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      console.error('❌ Create failed:', error);
      toast.error(`Failed to create: ${error.message}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Announcement.update(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['announcements'] });
      await refetch();
      setIsDialogOpen(false);
      resetForm();
      toast.success('Announcement updated successfully!');
    },
    onError: (error) => {
      console.error('Update error:', error);
      toast.error(`Failed to update announcement: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Announcement.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['announcements'] });
      await refetch();
      toast.success('Announcement deleted successfully!');
    }
  });

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      is_active: true,
      scheduled_for: null,
      expires_at: null
    });
    setEditingId(null);
  };

  const handleEdit = (announcement) => {
    setFormData({
      title: announcement.title,
      content: announcement.content,
      is_active: announcement.is_active,
      scheduled_for: announcement.scheduled_for ? new Date(announcement.scheduled_for) : null,
      expires_at: announcement.expires_at ? new Date(announcement.expires_at) : null
    });
    setEditingId(announcement.id);
    setIsDialogOpen(true);
  };

  const getAnnouncementStatus = (announcement) => {
    const now = new Date();
    const scheduledFor = announcement.scheduled_for ? new Date(announcement.scheduled_for) : null;
    const expiresAt = announcement.expires_at ? new Date(announcement.expires_at) : null;

    if (!announcement.is_active) return 'inactive';
    if (expiresAt && expiresAt < now) return 'expired';
    if (scheduledFor && scheduledFor > now) return 'scheduled';
    return 'active';
  };

  const filteredAnnouncements = announcements.filter(announcement => {
    const matchesSearch = 
      announcement.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      announcement.content?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const status = getAnnouncementStatus(announcement);
    const matchesStatus = statusFilter === 'all' || status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const dataToSubmit = {
      title: formData.title.trim(),
      content: formData.content.trim(),
      type: 'info',
      is_active: formData.is_active,
      priority: 0
    };

    // Only add dates if they exist
    if (formData.scheduled_for) {
      dataToSubmit.scheduled_for = formData.scheduled_for.toISOString();
    }
    if (formData.expires_at) {
      dataToSubmit.expires_at = formData.expires_at.toISOString();
    }
    
    
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: dataToSubmit });
    } else {
      createMutation.mutate(dataToSubmit);
    }
  };

  const toggleActive = (id, currentStatus) => {
    updateMutation.mutate({ id, data: { is_active: !currentStatus } });
  };

  const _getTypeColor = (type) => {
    switch (type) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'success': return 'bg-green-100 text-green-800';
      case 'warning': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <span className="font-semibold">Manage Announcements</span>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => refetch()}
                className="w-full sm:w-auto"
              >
                Refresh
              </Button>
              <Button 
                onClick={() => {
                  resetForm();
                  setIsDialogOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Announcement
              </Button>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search announcements..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-slate-500 text-center py-4">Loading...</p>
        ) : announcements.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">No announcements yet. Create one to get started!</p>
            <p className="text-xs text-slate-400 mt-2">Check browser console for details</p>
          </div>
        ) : filteredAnnouncements.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">No announcements match your filters</p>
            <p className="text-xs text-slate-400 mt-2">Total: {announcements.length}</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px] sm:h-[400px]">
            <div className="space-y-3 pr-2 sm:pr-3">
              {filteredAnnouncements.map((announcement) => {
                const status = getAnnouncementStatus(announcement);
                return (
                <div
                  key={announcement.id}
                  className={`p-3 sm:p-4 rounded-lg border ${
                    status === 'active' ? 'bg-white' : 
                    status === 'scheduled' ? 'bg-blue-50 border-blue-200' :
                    status === 'expired' ? 'bg-slate-50 opacity-60' : 
                    'bg-slate-50 opacity-60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start justify-between gap-2 sm:gap-3">
                    <div className="flex-1 min-w-0 w-full">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-semibold text-slate-900">{announcement.title}</h4>
                        {status === 'scheduled' && (
                          <Badge className="bg-blue-500 text-white">
                            <Clock className="w-3 h-3 mr-1" />
                            Scheduled
                          </Badge>
                        )}
                        {status === 'expired' && (
                          <Badge variant="outline" className="text-slate-500">
                            Expired
                          </Badge>
                        )}
                        {status === 'inactive' && (
                          <Badge variant="outline" className="text-slate-500">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mb-2">{announcement.content}</p>
                      <div className="space-y-1">
                        <p className="text-xs text-slate-500">
                          Created {formatEastern(announcement.created_date, 'MMM d, yyyy')}
                        </p>
                        {announcement.scheduled_for && (
                          <p className="text-xs text-blue-600 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Scheduled: {formatEastern(announcement.scheduled_for, 'MMM d, yyyy h:mm a')}
                          </p>
                        )}
                        {announcement.expires_at && (
                          <p className="text-xs text-orange-600">
                            Expires: {formatEastern(announcement.expires_at, 'MMM d, yyyy h:mm a')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex sm:flex-col gap-1 shrink-0 w-full sm:w-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive(announcement.id, announcement.is_active)}
                        title={announcement.is_active ? 'Deactivate' : 'Activate'}
                        className="flex-1 sm:flex-none"
                      >
                        {announcement.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(announcement)}
                        className="flex-1 sm:flex-none"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 flex-1 sm:flex-none"
                        onClick={() => setAnnouncementToDelete(announcement)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="w-[98vw] max-w-6xl overflow-visible">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Announcement' : 'Create Announcement'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4 overflow-visible">
            <div>
              <label htmlFor="announcement-title" className="text-sm font-medium">Title</label>
              <Input
                id="announcement-title"
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                required
                placeholder="Enter announcement title..."
                className="text-base"
              />
            </div>
            <div>
              <label htmlFor="announcement-content" className="text-sm font-medium">Content</label>
              <Textarea
                id="announcement-content"
                value={formData.content}
                onChange={(e) => setFormData({...formData, content: e.target.value})}
                required
                rows={3}
                placeholder="Enter announcement content..."
                className="text-base"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <Select 
                value={formData.is_active ? "active" : "inactive"} 
                onValueChange={(v) => setFormData({...formData, is_active: v === "active"})}
              >
                <SelectTrigger className="text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">Schedule For (Optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal text-sm sm:text-base">
                      <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{formData.scheduled_for ? format(formData.scheduled_for, 'PPp') : 'Select date & time'}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.scheduled_for}
                      onSelect={(date) => {
                        if (date) {
                          const now = new Date();
                          date.setHours(now.getHours(), now.getMinutes(), 0, 0);
                          setFormData({...formData, scheduled_for: date});
                        } else {
                          setFormData({...formData, scheduled_for: null});
                        }
                      }}
                      autoFocus
                    />
                    {formData.scheduled_for && (
                      <div className="p-3 border-t">
                        <Label className="text-xs">Time</Label>
                        <Input
                          type="time"
                          value={format(formData.scheduled_for, 'HH:mm')}
                          onChange={(e) => {
                            const [hours, minutes] = e.target.value.split(':');
                            const newDate = new Date(formData.scheduled_for);
                            newDate.setHours(parseInt(hours, 10), parseInt(minutes, 10));
                            setFormData({...formData, scheduled_for: newDate});
                          }}
                          className="mt-1"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setFormData({...formData, scheduled_for: null})}
                          className="w-full mt-2"
                        >
                          Clear
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-slate-500 mt-1">Leave empty to publish immediately</p>
              </div>

              <div>
                <Label className="text-sm font-medium">Expires At (Optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal text-sm sm:text-base">
                      <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{formData.expires_at ? format(formData.expires_at, 'PPp') : 'Select date & time'}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.expires_at}
                      onSelect={(date) => {
                        if (date) {
                          const _now = new Date();
                          date.setHours(23, 59, 59, 999);
                          setFormData({...formData, expires_at: date});
                        } else {
                          setFormData({...formData, expires_at: null});
                        }
                      }}
                      autoFocus
                    />
                    {formData.expires_at && (
                      <div className="p-3 border-t">
                        <Label className="text-xs">Time</Label>
                        <Input
                          type="time"
                          value={format(formData.expires_at, 'HH:mm')}
                          onChange={(e) => {
                            const [hours, minutes] = e.target.value.split(':');
                            const newDate = new Date(formData.expires_at);
                            newDate.setHours(parseInt(hours, 10), parseInt(minutes, 10));
                            setFormData({...formData, expires_at: newDate});
                          }}
                          className="mt-1"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setFormData({...formData, expires_at: null})}
                          className="w-full mt-2"
                        >
                          Clear
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-slate-500 mt-1">Leave empty for no expiration</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                className="bg-blue-600 hover:bg-blue-700"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!announcementToDelete} onOpenChange={(open) => { if (!open) setAnnouncementToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{announcementToDelete?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                deleteMutation.mutate(announcementToDelete.id);
                setAnnouncementToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}