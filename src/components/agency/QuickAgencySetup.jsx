import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Loader2 } from 'lucide-react';

export default function QuickAgencySetup({ currentUser, onAgencyCreated }) {
  const queryClient = useQueryClient();
  const [agencyName, setAgencyName] = useState('');
  const [maxUsers, setMaxUsers] = useState(10);

  const createAgencyMutation = useMutation({
    mutationFn: async () => {
      // Generate agency code
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      const newAgency = await base44.entities.Agency.create({
        agency_name: agencyName,
        agency_code: code,
        admin_email: currentUser.email,
        admin_user_ids: [currentUser.id],
        contact_email: currentUser.email,
        max_users: maxUsers,
        price_per_user: 29.99,
        status: 'trial',
        current_user_count: 1,
        enabled_features: [
          'SmartNoteAssistant',
          'MedicalScribe',
          'ClinicalDecisionSupport',
          'Compliance',
          'CarePlanManagement',
          'DocumentGenerator'
        ]
      });

      // Update user with agency code
      await base44.auth.updateMe({
        agency_code: code,
        agency_name: agencyName,
        joined_agency_date: new Date().toISOString().split('T')[0]
      });

      return newAgency;
    },
    onSuccess: (agency) => {
      queryClient.invalidateQueries({ queryKey: ['myAgency'] });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success('Agency created successfully!');
      onAgencyCreated?.(agency);
    },
    onError: (error) => {
      toast.error('Failed to create agency: ' + error.message);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-600" />
          Quick Agency Setup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Agency Name</Label>
          <Input
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
            placeholder="e.g., Metro Home Health Services"
          />
        </div>
        
        <div>
          <Label>Maximum Users</Label>
          <Input
            type="number"
            value={maxUsers}
            onChange={(e) => setMaxUsers(parseInt(e.target.value))}
            min="1"
            max="1000"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Number of providers who can join your agency
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-900">
            <strong>What you'll get:</strong>
          </p>
          <ul className="text-xs text-blue-800 mt-2 space-y-1 ml-4">
            <li>• Unique agency code for inviting team members</li>
            <li>• Agency-wide AI learning and best practices</li>
            <li>• Team performance analytics</li>
            <li>• Centralized compliance monitoring</li>
            <li>• Shared templates and phrase library</li>
          </ul>
        </div>

        <Button
          onClick={() => createAgencyMutation.mutate()}
          disabled={!agencyName.trim() || createAgencyMutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {createAgencyMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Agency...
            </>
          ) : (
            'Create My Agency'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}