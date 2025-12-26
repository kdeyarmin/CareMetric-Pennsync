import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Database, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function DataRetentionSettings() {
  const queryClient = useQueryClient();
  const [showHIPAADialog, setShowHIPAADialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [tempPreference, setTempPreference] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const currentPreference = currentUser?.data_retention_preference || 'delete_on_logout';
  const hasHIPAAConsent = currentUser?.hipaa_consent_accepted || false;

  const handlePreferenceChange = (value) => {
    if (value === 'save' && !hasHIPAAConsent) {
      setTempPreference(value);
      setShowHIPAADialog(true);
    } else {
      savePreference(value);
    }
  };

  const savePreference = async (preference) => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({
        data_retention_preference: preference
      });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    } catch (error) {
      console.error('Error saving preference:', error);
      alert('Failed to save preference. Please try again.');
    }
    setIsSaving(false);
  };

  const handleAcceptHIPAA = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({
        data_retention_preference: tempPreference,
        hipaa_consent_accepted: true,
        hipaa_consent_date: new Date().toISOString()
      });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setShowHIPAADialog(false);
      setTempPreference(null);
    } catch (error) {
      console.error('Error accepting HIPAA:', error);
      alert('Failed to save. Please try again.');
    }
    setIsSaving(false);
  };

  return (
    <>
      <Card className="border-2 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            Patient Data Retention
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <Shield className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-900">
              Choose how patient information is handled when you logout
            </AlertDescription>
          </Alert>

          <RadioGroup value={currentPreference} onValueChange={handlePreferenceChange} disabled={isSaving}>
            <div className="flex items-start space-x-3 p-4 border-2 rounded-lg hover:bg-gray-50 cursor-pointer">
              <RadioGroupItem value="delete_on_logout" id="delete" />
              <div className="flex-1">
                <Label htmlFor="delete" className="cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <Trash2 className="w-4 h-4 text-orange-600" />
                    <span className="font-semibold">Delete on Logout (Recommended)</span>
                  </div>
                  <p className="text-sm text-gray-600 font-normal">
                    All patient data will be permanently deleted when you logout. Use this for maximum privacy and security.
                  </p>
                </Label>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 border-2 rounded-lg hover:bg-gray-50 cursor-pointer">
              <RadioGroupItem value="save" id="save" />
              <div className="flex-1">
                <Label htmlFor="save" className="cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <Database className="w-4 h-4 text-green-600" />
                    <span className="font-semibold">Save Patient Data</span>
                  </div>
                  <p className="text-sm text-gray-600 font-normal">
                    Patient information will be retained for better AI recommendations. Requires HIPAA compliance acknowledgment.
                  </p>
                </Label>
              </div>
            </div>
          </RadioGroup>

          {currentPreference === 'save' && hasHIPAAConsent && (
            <Alert className="bg-green-50 border-green-300">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-sm text-green-900">
                HIPAA consent accepted on {currentUser?.hipaa_consent_date ? new Date(currentUser.hipaa_consent_date).toLocaleDateString() : 'unknown date'}
              </AlertDescription>
            </Alert>
          )}

          {currentPreference === 'delete_on_logout' && (
            <Alert className="bg-orange-50 border-orange-300">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <AlertDescription className="text-sm text-orange-900">
                <strong>Active:</strong> All patient data will be deleted when you logout.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* HIPAA Consent Dialog */}
      <Dialog open={showHIPAADialog} onOpenChange={setShowHIPAADialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Shield className="w-6 h-6 text-blue-600" />
              HIPAA Compliance & Data Retention
            </DialogTitle>
            <DialogDescription className="sr-only">
              HIPAA compliance statement for saving patient data
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <Alert className="bg-red-50 border-red-300">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <AlertDescription className="text-sm text-red-900 font-medium">
                IMPORTANT: By choosing to save patient data, you are responsible for HIPAA compliance
              </AlertDescription>
            </Alert>

            <div className="space-y-3 text-sm">
              <h3 className="font-bold text-gray-900 text-base">Legal Statement:</h3>
              
              <p className="text-gray-700">
                By selecting to save patient information in this application, you acknowledge and agree to the following:
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">1. HIPAA Compliance Responsibility</h4>
                <p className="text-gray-700">
                  You are solely responsible for ensuring that your use of this application complies with the Health Insurance Portability and Accountability Act (HIPAA) and all applicable privacy laws. You must maintain appropriate safeguards to protect Protected Health Information (PHI).
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">2. Data Security</h4>
                <ul className="list-disc list-inside space-y-1 text-gray-700 ml-2">
                  <li>Keep your account credentials secure and confidential</li>
                  <li>Never share your login information with unauthorized individuals</li>
                  <li>Always logout when using shared or public devices</li>
                  <li>Ensure your device has appropriate security measures (passwords, encryption)</li>
                </ul>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">3. Minimum Necessary Standard</h4>
                <p className="text-gray-700">
                  Only save the minimum necessary patient information required for providing care and generating accurate AI recommendations.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">4. Data Breach Reporting</h4>
                <p className="text-gray-700">
                  In the event of a suspected data breach or unauthorized access, you must immediately take appropriate action according to your organization's policies and applicable law.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">5. Right to Delete</h4>
                <p className="text-gray-700">
                  You may change this setting at any time to delete all saved patient data. You can also manually delete individual patient records as needed.
                </p>
              </div>

              <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
                <p className="text-gray-800 font-medium">
                  <strong>Recommendation:</strong> If you work in multiple settings or use shared devices, consider using "Delete on Logout" mode for maximum security. Patient data can always be re-entered when needed.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowHIPAADialog(false);
                setTempPreference(null);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAcceptHIPAA}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? "Saving..." : "I Accept - Save Patient Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}