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
  DialogFooter } from
"@/components/ui/dialog";

export default function DataRetentionSettings() {
  const queryClient = useQueryClient();
  const [showHIPAADialog, setShowHIPAADialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [tempPreference, setTempPreference] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
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
      const updates = {
        data_retention_preference: preference
      };

      // If switching to delete_on_logout, disable 2FA
      if (preference === 'delete_on_logout') {
        updates.two_factor_enabled = false;
      }

      await base44.auth.updateMe(updates);
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
        hipaa_consent_date: new Date().toISOString(),
        two_factor_enabled: true // Automatically enable 2FA when saving patient data
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
        <CardHeader className="bg-slate-200 p-6 flex flex-col space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            Patient Data Retention
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-slate-100 pt-0 p-6 space-y-4">
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
                    <Shield className="w-4 h-4 text-blue-600" />
                  </div>
                  <p className="text-sm text-gray-600 font-normal">
                    Patient information will be retained for better AI recommendations. Requires HIPAA compliance acknowledgment and automatically enables Two-Factor Authentication.
                  </p>
                </Label>
              </div>
            </div>
          </RadioGroup>

          {currentPreference === 'save' && hasHIPAAConsent &&
          <Alert className="bg-green-50 border-green-300">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-sm text-green-900">
                <div>
                  <p className="font-semibold mb-1">✓ Data Retention Active</p>
                  <p>HIPAA consent accepted on {currentUser?.hipaa_consent_date ? new Date(currentUser.hipaa_consent_date).toLocaleDateString() : 'unknown date'}</p>
                  <p className="mt-1">Two-Factor Authentication: <span className="font-semibold">Enabled</span></p>
                </div>
              </AlertDescription>
            </Alert>
          }

          {currentPreference === 'delete_on_logout' &&
          <Alert className="bg-orange-50 border-orange-300">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <AlertDescription className="text-sm text-orange-900">
                <div>
                  <p><strong>Active:</strong> All patient data will be deleted when you logout.</p>
                  <p className="mt-1">Two-Factor Authentication: <span className="font-semibold">Disabled</span></p>
                </div>
              </AlertDescription>
            </Alert>
          }
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
              <h3 className="font-bold text-gray-900 text-base">HIPAA Privacy and Security Statement</h3>
              
              <p className="text-gray-700 font-medium">
                By selecting to save patient information in this application, you acknowledge and agree to the following terms regarding Protected Health Information (PHI):
              </p>

              <div className="bg-gray-50 border border-gray-300 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">Privacy Rule Compliance</h4>
                <p className="text-gray-700">
                  You affirm that your use and disclosure of PHI through this application complies with the HIPAA Privacy Rule (45 CFR Part 160 and Part 164, Subparts A and E). You will only access, use, and disclose the minimum necessary PHI required to accomplish the intended purpose.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">1. HIPAA Compliance Responsibility</h4>
                <p className="text-gray-700">
                  You are solely responsible for ensuring that your use of this application complies with the Health Insurance Portability and Accountability Act (HIPAA) and all applicable privacy laws. You must maintain appropriate safeguards to protect Protected Health Information (PHI).
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">2. Security Rule Requirements</h4>
                <p className="text-gray-700">
                  You acknowledge your responsibility to implement and maintain appropriate administrative, physical, and technical safeguards as required by the HIPAA Security Rule (45 CFR Part 164, Subparts A and C) including:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-700 ml-2">
                  <li><strong>Access Controls:</strong> Keep account credentials secure and confidential; never share login information</li>
                  <li><strong>Device Security:</strong> Ensure devices used to access PHI have passwords, encryption, and anti-malware protection</li>
                  <li><strong>Session Management:</strong> Always logout when finished, especially on shared or public devices</li>
                  <li><strong>Physical Safeguards:</strong> Prevent unauthorized physical access to devices containing PHI</li>
                  <li><strong>Audit Controls:</strong> Understand that all access to PHI is logged and monitored</li>
                </ul>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">3. Minimum Necessary Standard</h4>
                <p className="text-gray-700">
                  Only save the minimum necessary patient information required for providing care and generating accurate AI recommendations.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">4. Breach Notification Requirements</h4>
                <p className="text-gray-700">
                  You agree to immediately report any suspected breach of PHI, including unauthorized access, use, or disclosure. You understand that breach notification requirements under 45 CFR §164.400-414 may apply, and you will follow your organization's incident response procedures and notify appropriate parties without unreasonable delay.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">5. Individual Rights</h4>
                <p className="text-gray-700">
                  You acknowledge that patients have rights under HIPAA including the right to access their PHI, request amendments, receive an accounting of disclosures, and request restrictions on uses and disclosures. You will honor these rights in accordance with applicable law.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">6. Data Retention and Disposal</h4>
                <p className="text-gray-700">
                  You may change this setting at any time to delete all saved patient data. You understand that secure deletion of PHI is required when it is no longer needed. You can manually delete individual patient records as needed, and understand that deletion is permanent and cannot be undone.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">7. No Business Associate Agreement (BAA)</h4>
                <p className="text-gray-700">
                  <strong>IMPORTANT:</strong> This application serves as a tool for individual nurse use. If you are using this application on behalf of a covered entity (healthcare provider, health plan, or healthcare clearinghouse), you acknowledge that your organization may need to obtain a Business Associate Agreement (BAA) with Penn Sync before storing PHI. Consult with your organization's compliance officer or legal counsel.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900">8. State Law Compliance</h4>
                <p className="text-gray-700">
                  You acknowledge that state privacy laws may impose additional requirements beyond HIPAA, and you are responsible for complying with all applicable state and federal privacy and security laws.
                </p>
              </div>

              <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 space-y-2">
                <p className="text-gray-800">
                  <strong>⚠️ Security Recommendation:</strong> For maximum privacy and security, especially if you work in multiple settings or use shared/public devices, we strongly recommend selecting "Delete on Logout" mode. This ensures PHI is never retained longer than necessary and eliminates risk of unauthorized access.
                </p>
                <p className="text-gray-700 text-xs mt-2">
                  Patient data can always be re-entered when needed. The AI recommendations will still function effectively even without saved historical data.
                </p>
              </div>

              <div className="bg-red-50 border-2 border-red-400 rounded-lg p-4 mt-4">
                <p className="text-red-900 font-bold text-center">
                  By clicking "I Accept" below, you certify that you have read, understood, and agree to comply with all terms of this HIPAA Privacy and Security Statement.
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
              disabled={isSaving}>

              Cancel
            </Button>
            <Button
              onClick={handleAcceptHIPAA}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700">

              {isSaving ? "Saving..." : "I Accept - Save Patient Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>);

}