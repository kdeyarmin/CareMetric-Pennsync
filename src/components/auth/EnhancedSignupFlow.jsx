import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function EnhancedSignupFlow({ onComplete }) {
  const [userData, setUserData] = useState({
    full_name: '',
    email: '',
    credential_type: ''
  });

  const updateUserMutation = useMutation({
    mutationFn: async (data) => {
      await base44.auth.updateMe(data);
    },
    onSuccess: () => {
      toast.success('Welcome! Your 14-day free trial has started.');
      // Skip directly to dashboard - trial is auto-created by onUserSignup
      if (onComplete) {
        onComplete();
      } else {
        window.location.href = '/';
      }
    },
    onError: (error) => {
      toast.error('Failed to save information. Please try again.');
      console.error(error);
    }
  });

  const handleBasicInfoSubmit = (e) => {
    e.preventDefault();
    if (!userData.full_name || !userData.email || !userData.credential_type) {
      toast.error('Please fill in all fields');
      return;
    }
    updateUserMutation.mutate(userData);
  };

  // Single step: Basic Information with auto-trial
  return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl">Welcome to CareMetric AI</CardTitle>
            <p className="text-sm text-gray-600 mt-2">
              Start your free 14-day trial - no credit card required
            </p>
            <Badge className="bg-green-100 text-green-800 mt-3">
              ✨ Full access, cancel anytime
            </Badge>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleBasicInfoSubmit} className="space-y-4">
              <div>
                <Label>Full Name *</Label>
                <Input
                  value={userData.full_name}
                  onChange={(e) => setUserData({ ...userData, full_name: e.target.value })}
                  placeholder="Dr. Jane Smith"
                  required
                  className="h-11"
                />
              </div>

              <div>
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={userData.email}
                  onChange={(e) => setUserData({ ...userData, email: e.target.value })}
                  placeholder="you@example.com"
                  required
                  className="h-11"
                />
              </div>

              <div>
                <Label>Your Role *</Label>
                <select
                  value={userData.credential_type}
                  onChange={(e) => setUserData({ ...userData, credential_type: e.target.value })}
                  className="w-full h-11 px-3 border rounded-md"
                  required
                >
                  <option value="">Select your credential</option>
                  <option value="RN">Registered Nurse (RN)</option>
                  <option value="LPN">Licensed Practical Nurse (LPN)</option>
                  <option value="NP">Nurse Practitioner (NP)</option>
                  <option value="PHYSICIAN">Physician</option>
                  <option value="THERAPIST">Therapist (PT/OT/ST)</option>
                  <option value="MSW">Medical Social Worker</option>
                  <option value="Chiropractor">Chiropractor</option>
                </select>
              </div>

              <Button
                type="submit"
                disabled={updateUserMutation.isPending}
                className="w-full h-11 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                {updateUserMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Start Free Trial <Sparkles className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
              
              <p className="text-xs text-center text-gray-500 mt-3">
                By continuing, you agree to our Terms of Service and Privacy Policy
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
}