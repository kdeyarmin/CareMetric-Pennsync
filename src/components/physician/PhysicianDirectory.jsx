import { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Search, Plus, Edit, Trash2, Phone, Mail, MapPin, 
  UserPlus, Star, Send, FileText
} from 'lucide-react';
import PhysicianForm from './PhysicianForm';
import ProviderCsvImport from './ProviderCsvImport';
import { toast } from 'sonner';

export default function PhysicianDirectory({ onSelectPhysician, mode = 'directory' }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingPhysician, setEditingPhysician] = useState(null);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data: physicians = [], isLoading } = useQuery({
    queryKey: ['physicians'],
    queryFn: () => base44.entities.Physician.filter({ is_active: true }, '-referral_count', 500),
    initialData: [],
  });

  const deletePhysicianMutation = useMutation({
    mutationFn: (id) => base44.entities.Physician.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['physicians'] });
      toast.success('Provider removed from directory');
    },
  });

  const incrementReferralMutation = useMutation({
    mutationFn: ({ id, count }) => 
      base44.entities.Physician.update(id, { 
        referral_count: count + 1,
        last_referral_date: new Date().toISOString().split('T')[0]
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['physicians'] });
    },
  });

  const filteredPhysicians = useMemo(() => {
    return physicians.filter(doc => {
      const matchesSearch = !searchTerm || 
        doc.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.practice_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.specialty?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesSpecialty = specialtyFilter === 'all' || doc.specialty === specialtyFilter;
      
      return matchesSearch && matchesSpecialty;
    });
  }, [physicians, searchTerm, specialtyFilter]);

  const handleSelectPhysician = (physician) => {
    if (onSelectPhysician) {
      incrementReferralMutation.mutate({ 
        id: physician.id, 
        count: physician.referral_count || 0 
      });
      onSelectPhysician(physician);
    }
  };

  const getSpecialtyLabel = (specialty) => {
    return specialty
      ? specialty.replace(/_/g, ' ').split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      : 'N/A';
  };

  const specialties = useMemo(() => (
    Array.from(new Set(physicians.map((item) => item.specialty).filter(Boolean))).sort()
  ), [physicians]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-slate-500">Loading provider directory...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="shadow-lg">
        <CardHeader className="border-b bg-gradient-to-r from-slate-50 to-blue-50">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md">
                <UserPlus className="w-5 h-5 text-white" />
              </div>
              <span>Provider Directory</span>
            </CardTitle>
            {mode === 'directory' && (
              <div className="flex gap-2 flex-wrap">
                <ProviderCsvImport onImported={() => queryClient.invalidateQueries({ queryKey: ['physicians'] })} />
                <Button onClick={() => { setEditingPhysician(null); setShowForm(true); }} className="bg-indigo-600 hover:bg-indigo-700 min-h-[44px]">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Provider
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          {/* Search & Filters */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by provider, practice, specialty, or tags..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            <div className="flex gap-2">
              <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
                <SelectTrigger className="w-full h-11">
                  <SelectValue placeholder="Filter by specialty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Specialties</SelectItem>
                  {specialties.map(spec => (
                    <SelectItem key={spec} value={spec}>
                      {getSpecialtyLabel(spec)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Results */}
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
            {filteredPhysicians.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <UserPlus className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                <p className="text-lg font-medium text-slate-700">No providers found</p>
                <p className="text-sm text-slate-500 mt-1">Try adjusting your search or filters</p>
              </div>
            ) : (
              filteredPhysicians.map((physician) => (
                <Card 
                  key={physician.id} 
                  className={`hover:shadow-lg hover:-translate-y-0.5 transition-all ${
                    mode === 'selector' ? 'cursor-pointer hover:border-indigo-400' : ''
                  }`}
                  onClick={() => mode === 'selector' && handleSelectPhysician(physician)}
                >
                  <CardContent className="p-5">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-slate-900">
                              {physician.full_name}
                              {physician.credentials && <span className="text-sm text-slate-600 ml-1">{physician.credentials}</span>}
                            </h3>
                            {(physician.referral_count || 0) > 10 && (
                              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                                <Star className="w-3 h-3 mr-1" />
                                Frequent
                              </Badge>
                            )}
                          </div>
                          <Badge variant="outline" className="mb-2">
                            {getSpecialtyLabel(physician.specialty)}
                          </Badge>
                          {physician.subspecialty && (
                            <Badge variant="outline" className="ml-1 mb-2">
                              {physician.subspecialty}
                            </Badge>
                          )}
                          {physician.practice_name && (
                            <p className="text-sm text-slate-600 flex items-center gap-1 mb-1">
                              <FileText className="w-3 h-3" />
                              {physician.practice_name}
                            </p>
                          )}
                        </div>
                        {mode === 'directory' && (
                          <div className="flex gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingPhysician(physician);
                                setShowForm(true);
                              }}
                              className="h-9 w-9 hover:bg-indigo-50 hover:text-indigo-600"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (await confirm({ title: "Remove provider?", description: "Remove this provider from the directory?", confirmText: "Remove", destructive: true })) {
                                  deletePhysicianMutation.mutate(physician.id);
                                }
                              }}
                              className="h-9 w-9 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1 text-sm text-slate-600">
                        {physician.fax_number && (
                          <div className="flex items-center gap-2">
                            <Send className="w-3 h-3" />
                            <span className="font-medium">Fax:</span> {physician.fax_number}
                          </div>
                        )}
                        {physician.phone_number && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-3 h-3" />
                            <span className="font-medium">Phone:</span> {physician.phone_number}
                          </div>
                        )}
                        {physician.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-3 h-3" />
                            <span className="font-medium">Email:</span> {physician.email}
                          </div>
                        )}
                        {physician.office_address && (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3 h-3" />
                            <span>{physician.office_address}, {physician.office_city}, {physician.office_state} {physician.office_zip}</span>
                          </div>
                        )}
                      </div>

                      {physician.tags && physician.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-2">
                          {physician.tags.map((tag, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {physician.referral_count > 0 && (
                        <div className="text-xs text-slate-500 pt-1">
                          {physician.referral_count} referral{physician.referral_count !== 1 ? 's' : ''}
                          {physician.last_referral_date && ` • Last: ${new Date(physician.last_referral_date).toLocaleDateString()}`}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="text-sm text-slate-500 text-center pt-4 border-t">
            {filteredPhysicians.length} provider{filteredPhysicians.length !== 1 ? 's' : ''} found
          </div>
        </CardContent>
      </Card>

      {/* Physician Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPhysician ? 'Edit Provider' : 'Add New Provider'}
            </DialogTitle>
          </DialogHeader>
          <PhysicianForm
            physician={editingPhysician}
            onClose={() => {
              setShowForm(false);
              setEditingPhysician(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}