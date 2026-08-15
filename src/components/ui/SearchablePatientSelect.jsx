import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Clock, Star, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

export default function SearchablePatientSelect({
  patients = [],
  value,
  onValueChange,
  onChange, // Support both for backwards compatibility
  placeholder = "Select patient...",
  className,
  id, // forwarded to the trigger so a <Label htmlFor> can target this control
}) {
  // Use either onValueChange or onChange
  const handleChange = onValueChange || onChange || (() => {});
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recentPatients, setRecentPatients] = useState([]);
  const [favoritedPatients, setFavoritedPatients] = useState([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({ first_name: "", last_name: "" });
  const [creating, setCreating] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const queryClient = useQueryClient();
  const [localPatients, setLocalPatients] = useState(Array.isArray(patients) ? patients : []);

  // Sync local patients when prop changes
  useEffect(() => {
    let patientArray = [];
    if (Array.isArray(patients)) {
      patientArray = patients;
    } else if (patients?.data && Array.isArray(patients.data)) {
      patientArray = patients.data;
    }
    setLocalPatients(patientArray);
  }, [patients]);

  // Load current user and their preferences. Favorites live on User.favorited_patients
  // (sidebar + alerts read that field); localStorage is a fast cache / offline fallback.
  useEffect(() => {
    const loadUserPreferences = async () => {
      try {
        const user = await base44.auth.me();
        const userEmail = user?.email || 'default';
        setCurrentUserEmail(userEmail);

        const recent = JSON.parse(localStorage.getItem(`recentPatients_${userEmail}`) || '[]');
        setRecentPatients(recent);

        const fromUser = (user?.favorited_patients || [])
          .map((fav) => (typeof fav === 'string' ? fav : fav?.id))
          .filter(Boolean);
        const fromLocal = JSON.parse(localStorage.getItem(`favoritedPatients_${userEmail}`) || '[]');
        // Prefer the persisted User field; merge any local-only stars so we don't
        // silently drop favorites that never got written to the profile.
        const merged = [...new Set([...fromUser, ...fromLocal])];
        setFavoritedPatients(merged);
        if (fromLocal.length > 0 && fromUser.length === 0) {
          // One-time migration: promote localStorage favorites onto the user profile
          // so the sidebar / alerts dashboard can see them.
          base44.auth.updateMe({ favorited_patients: merged }).catch(() => {});
        }
      } catch (error) {
        console.error('Error loading patient preferences:', error);
      }
    };
    loadUserPreferences();
  }, []);

  // Save to recent when patient is selected
  const handleSelect = (patientId) => {
    handleChange(patientId);
    setOpen(false);

    if (!currentUserEmail) return;

    // Update recent patients (max 5)
    const updatedRecent = [
      patientId,
      ...recentPatients.filter(id => id !== patientId)
    ].slice(0, 5);
    
    setRecentPatients(updatedRecent);
    try { localStorage.setItem(`recentPatients_${currentUserEmail}`, JSON.stringify(updatedRecent)); } catch { /* no-op */ }
  };

  // Toggle favorite — persist to User.favorited_patients (and local cache) so the
  // sidebar Favorites rail and PatientAlertsDashboard can read the same list.
  const toggleFavorite = (patientId, e) => {
    e.stopPropagation();
    if (!currentUserEmail) return;
    
    const isFavorited = favoritedPatients.includes(patientId);
    
    const updatedFavorites = isFavorited
      ? favoritedPatients.filter(id => id !== patientId)
      : [...favoritedPatients, patientId];
    
    setFavoritedPatients(updatedFavorites);
    try { localStorage.setItem(`favoritedPatients_${currentUserEmail}`, JSON.stringify(updatedFavorites)); } catch { /* no-op */ }
    base44.auth.updateMe({ favorited_patients: updatedFavorites }).catch((err) => {
      toast.error(err?.message || 'Could not save favorite');
    });
  };

  // Create new patient
  const handleCreatePatient = async () => {
    if (!newPatient.first_name || !newPatient.last_name) return;
    
    setCreating(true);
    try {
      const created = await base44.entities.Patient.create(newPatient);
      setLocalPatients((current) => [created, ...current]);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      handleSelect(created.id);
      setCreateDialogOpen(false);
      setNewPatient({ first_name: "", last_name: "" });
    } catch (error) {
      // Surface the failure (the dialog stays open so the entry isn't lost).
      toast.error(error?.message || 'Failed to create patient. Please try again.');
    }
    setCreating(false);
  };

  // Pre-fill new patient with search term
  const openCreateDialog = () => {
    const names = search.trim().split(' ');
    setNewPatient({
      first_name: names[0] || "",
      last_name: names.slice(1).join(' ') || ""
    });
    setCreateDialogOpen(true);
    setOpen(false);
  };

  // Get patient by ID
  const getPatient = (id) => localPatients.find(p => p.id === id);
  const selectedPatient = getPatient(value);

  // Filter and organize patients
  const { favoritesList, recentList, allPatientsList } = useMemo(() => {
    const searchLower = search.toLowerCase().trim();
    const filtered = localPatients.filter(p => {
      if (!p) return false;
      const firstName = (p.first_name || '').trim().toLowerCase();
      const lastName = (p.last_name || '').trim().toLowerCase();
      const fullName = `${firstName} ${lastName}`;
      const mrn = (p.medical_record_number || '').trim().toLowerCase();
      return fullName.includes(searchLower) || mrn.includes(searchLower) || firstName.includes(searchLower) || lastName.includes(searchLower);
    }).sort((a, b) => {
      const aName = `${(a.last_name || '').trim()} ${(a.first_name || '').trim()}`.toLowerCase();
      const bName = `${(b.last_name || '').trim()} ${(b.first_name || '').trim()}`.toLowerCase();
      return aName.localeCompare(bName);
    });

    const favoriteIds = new Set(favoritedPatients);
    const favorites = filtered.filter(p => favoriteIds.has(p.id));

    // Order Recent by most-recently-used (recentPatients is prepended on select),
    // not alphabetically, and cap at 3.
    const recent = recentPatients
      .map(id => filtered.find(p => p.id === id))
      .filter(p => p && !favoriteIds.has(p.id))
      .slice(0, 3);

    // Only exclude the recents actually shown above from "All Patients" —
    // excluding every recent id would drop a 4th/5th recent patient from both
    // groups, hiding them from the picker entirely.
    const shownRecentIds = new Set(recent.map(p => p.id));
    const all = filtered.filter(p =>
      !favoriteIds.has(p.id) && !shownRecentIds.has(p.id)
    );

    return {
      favoritesList: favorites,
      recentList: recent,
      allPatientsList: all
    };
  }, [localPatients, search, favoritedPatients, recentPatients]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={false}>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={false}
          className={cn(
            "w-full justify-between h-11 md:h-12 text-base",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {value && selectedPatient
              ? `${selectedPatient.first_name}${selectedPatient.middle_name ? ` ${selectedPatient.middle_name}` : ''} ${selectedPatient.last_name}`
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] max-w-[500px] p-0"
        align="start"
        side="bottom"
        sideOffset={8}
        avoidCollisions={false}
      >
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search patients..." 
            value={search}
            onValueChange={setSearch}
            className="border-b-0"
          />
          <CommandList className="max-h-[400px]">
            {/* Plain divs, not CommandEmpty: with shouldFilter={false} cmdk sets
                its filtered count to the number of registered items, and the
                "Add new patient" item below is always registered — so a
                CommandEmpty here could never render and the user saw a blank
                list instead of these messages. */}
            {localPatients.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">No patients available. (Loaded: {localPatients.length})</p>
                <Button
                  onClick={openCreateDialog}
                  size="sm"
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create New Patient
                </Button>
              </div>
            ) : favoritesList.length === 0 && recentList.length === 0 && allPatientsList.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">No patients match your search.</p>
              </div>
            ) : null}
            
            {favoritesList.length > 0 && (
              <CommandGroup heading="Favorites">
                {favoritesList.map((patient) => (
                 <CommandItem
                   key={patient.id}
                   value={patient.id}
                   onSelect={() => handleSelect(patient.id)}
                   disabled={false}
                   className="flex items-center justify-between py-3 cursor-pointer"
                 >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Check
                        className={cn(
                          "h-4 w-4 flex-shrink-0",
                          value === patient.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex-1">
                       <p className="font-medium">
                         {patient.first_name} {patient.middle_name ? `${patient.middle_name} ` : ''}{patient.last_name}
                       </p>
                       {patient.medical_record_number && (
                         <p className="text-xs text-muted-foreground">
                           MRN: {patient.medical_record_number}
                         </p>
                       )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={(e) => toggleFavorite(patient.id, e)}
                    >
                      <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    </Button>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {recentList.length > 0 && (
              <CommandGroup heading="Recent">
                {recentList.map((patient) => (
                 <CommandItem
                   key={patient.id}
                   value={patient.id}
                   onSelect={() => handleSelect(patient.id)}
                   disabled={false}
                   className="flex items-center justify-between py-3 cursor-pointer"
                 >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Check
                        className={cn(
                          "h-4 w-4 flex-shrink-0",
                          value === patient.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1">
                       <p className="font-medium">
                         {patient.first_name} {patient.middle_name ? `${patient.middle_name} ` : ''}{patient.last_name}
                       </p>
                       {patient.medical_record_number && (
                         <p className="text-xs text-muted-foreground">
                           MRN: {patient.medical_record_number}
                         </p>
                       )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={(e) => toggleFavorite(patient.id, e)}
                    >
                      <Star className={cn(
                        "h-4 w-4",
                        favoritedPatients.includes(patient.id) 
                          ? "fill-yellow-400 text-yellow-400" 
                          : "text-muted-foreground"
                      )} />
                    </Button>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {allPatientsList.length > 0 && (
              <CommandGroup heading="All Patients">
                {allPatientsList.map((patient) => (
                 <CommandItem
                   key={patient.id}
                   value={patient.id}
                   onSelect={() => handleSelect(patient.id)}
                   disabled={false}
                   className="flex items-center justify-between py-3 cursor-pointer"
                 >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Check
                        className={cn(
                          "h-4 w-4 flex-shrink-0",
                          value === patient.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex-1">
                       <p className="font-medium">
                         {patient.first_name} {patient.middle_name ? `${patient.middle_name} ` : ''}{patient.last_name}
                       </p>
                       {patient.medical_record_number && (
                         <p className="text-xs text-muted-foreground">
                           MRN: {patient.medical_record_number}
                         </p>
                       )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={(e) => toggleFavorite(patient.id, e)}
                    >
                      <Star className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup className="border-t">
              <CommandItem
                value="__add_new_patient__"
                onSelect={openCreateDialog}
                className="flex items-center gap-2 py-3 cursor-pointer text-navy-700 font-medium"
              >
                <Plus className="h-4 w-4 flex-shrink-0" />
                {search.trim() ? `Add "${search.trim()}" as new patient` : "Add new patient"}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Patient</DialogTitle>
            <DialogDescription>
              Add a new patient to the system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                value={newPatient.first_name}
                onChange={(e) => setNewPatient({ ...newPatient, first_name: e.target.value })}
                placeholder="Enter first name"
              />
            </div>
            <div>
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                value={newPatient.last_name}
                onChange={(e) => setNewPatient({ ...newPatient, last_name: e.target.value })}
                placeholder="Enter last name"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button 
              variant="outline" 
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreatePatient}
              disabled={!newPatient.first_name || !newPatient.last_name || creating}
            >
              {creating ? "Creating..." : "Create Patient"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Popover>
  );
}