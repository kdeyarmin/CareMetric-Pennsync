import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { User, Search, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { hapticFeedback } from './PlatformOptimizations';

/**
 * Optimized patient list with virtualization for mobile performance
 */
export default function OptimizedPatientList({ patients, alerts = [] }) {
  const [search, setSearch] = useState('');
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });

  // Filter patients based on search
  const filteredPatients = useMemo(() => {
    if (!search.trim()) return patients;
    
    const searchLower = search.toLowerCase();
    return patients.filter(p => 
      p.first_name?.toLowerCase().includes(searchLower) ||
      p.last_name?.toLowerCase().includes(searchLower) ||
      p.medical_record_number?.toLowerCase().includes(searchLower)
    );
  }, [patients, search]);

  // Get visible patients for current scroll position
  const visiblePatients = filteredPatients.slice(visibleRange.start, visibleRange.end);

  // Get alert count for patient
  const getPatientAlertCount = (patientId) => {
    return alerts.filter(a => a.patient_id === patientId && a.status === 'active').length;
  };

  const handlePatientClick = () => {
    hapticFeedback('light');
  };

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search patients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Patient List */}
      <div className="space-y-2">
        {visiblePatients.map((patient) => {
          const alertCount = getPatientAlertCount(patient.id);
          
          return (
            <Link
              key={patient.id}
              to={`${createPageUrl('PatientDetails')}?id=${patient.id}`}
              onClick={handlePatientClick}
            >
              <Card className="hover:shadow-md transition-shadow active:scale-[0.98]">
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">
                        {patient.first_name} {patient.last_name}
                      </p>
                      <p className="text-xs text-gray-600 truncate">
                        MRN: {patient.medical_record_number || 'N/A'}
                      </p>
                    </div>
                    {alertCount > 0 && (
                      <Badge className="bg-red-600 text-white flex-shrink-0">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {alertCount}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Load More */}
      {visibleRange.end < filteredPatients.length && (
        <Button
          variant="outline"
          onClick={() => setVisibleRange(prev => ({ ...prev, end: prev.end + 20 }))}
          className="w-full"
        >
          Load More ({filteredPatients.length - visibleRange.end} remaining)
        </Button>
      )}
    </div>
  );
}