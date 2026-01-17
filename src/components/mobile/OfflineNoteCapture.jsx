import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { WifiOff, Save, Upload, Shield } from 'lucide-react';
import { offlineStorage } from './EnhancedOfflineStorage';
import { secureOfflineStorage } from './SecureOfflineStorage';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

export default function OfflineNoteCapture({ 
  patientId, 
  visitType, 
  diagnosis,
  onNoteSaved 
}) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const saveOffline = async () => {
    if (!notes.trim()) {
      toast.error('Please enter some notes');
      return;
    }

    setSaving(true);
    try {
      const user = await base44.auth.me();
      await offlineStorage.init();
      
      const noteData = {
        patient_id: patientId,
        visit_type: visitType,
        diagnosis: diagnosis,
        rough_notes: notes,
        timestamp: new Date().toISOString(),
        nurse_email: user?.email || 'offline_user',
        vital_signs: {}
      };

      // Use encrypted storage for patient data
      await secureOfflineStorage.saveEncryptedNote(noteData, user?.email);
      
      toast.success('Note saved offline with encryption - will sync when back online');
      setNotes('');
      
      if (onNoteSaved) onNoteSaved();
    } catch (error) {
      console.error('Error saving offline:', error);
      toast.error('Failed to save offline note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={!isOnline ? 'border-orange-300 bg-orange-50' : ''}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-base">
            Quick Note Capture
          </span>
          {!isOnline && (
            <Badge className="bg-orange-600">
              <WifiOff className="w-3 h-3 mr-1" />
              Offline Mode
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Quick clinical notes... (saved locally if offline)"
          className="h-32"
        />
        
        <Button
          onClick={saveOffline}
          disabled={saving}
          className="w-full"
        >
          {saving ? (
            <>
              <Save className="w-4 h-4 mr-2 animate-pulse" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              {isOnline ? 'Save Note' : 'Save Offline'}
            </>
          )}
        </Button>

        {!isOnline && (
          <div className="space-y-1">
            <p className="text-xs text-orange-700 text-center">
              Note will be synced automatically when connection is restored
            </p>
            <p className="text-xs text-green-700 text-center flex items-center justify-center gap-1">
              <Shield className="w-3 h-3" />
              Encrypted locally for HIPAA compliance
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}