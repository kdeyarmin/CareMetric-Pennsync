import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Search, 
  User,
  Phone,
  Calendar,
  Heart,
  Loader2
} from 'lucide-react';

export default function AdvancedPatientSearch({ onSelectPatient }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const { data: patients } = useQuery({
    queryKey: ['all-patients'],
    queryFn: () => base44.entities.Patient.filter({})
  });

  const handleSearch = () => {
    if (!searchQuery.trim() || !patients) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const query = searchQuery.toLowerCase();
    
    const results = patients.filter(p => 
      p.full_name?.toLowerCase().includes(query) ||
      p.email?.toLowerCase().includes(query) ||
      p.phone?.includes(query) ||
      p.date_of_birth?.includes(query) ||
      p.primary_diagnosis?.toLowerCase().includes(query) ||
      p.medical_record_number?.includes(query)
    ).slice(0, 10);

    setSearchResults(results);
    setIsSearching(false);
  };

  React.useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch();
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, patients]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
        <Input
          placeholder="Search by name, phone, DOB, MRN, or diagnosis..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 text-lg h-12"
        />
      </div>

      {searchQuery && (
        <div className="space-y-2">
          {isSearching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : searchResults.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-slate-600">No patients found</p>
              </CardContent>
            </Card>
          ) : (
            searchResults.map(patient => (
              <Card 
                key={patient.id} 
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => onSelectPatient?.(patient)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="h-4 w-4 text-slate-600" />
                        <h3 className="font-semibold">{patient.full_name}</h3>
                        <Badge variant={patient.status === 'active' ? 'default' : 'outline'}>
                          {patient.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          DOB: {patient.date_of_birth || 'N/A'}
                        </div>
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {patient.phone || 'N/A'}
                        </div>
                        {patient.medical_record_number && (
                          <div className="col-span-2">
                            MRN: {patient.medical_record_number}
                          </div>
                        )}
                        {patient.primary_diagnosis && (
                          <div className="col-span-2 flex items-center gap-1">
                            <Heart className="h-3 w-3" />
                            {patient.primary_diagnosis}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}