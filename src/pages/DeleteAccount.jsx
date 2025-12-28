import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";

export default function DeleteAccount() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Delete Your Account</h1>
          <p className="text-gray-600">CareMetric AI Account Deletion</p>
        </div>

        <Card className="mb-6 border-red-200">
          <CardHeader className="bg-red-50">
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              Important Information
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4 text-gray-700">
              <p className="font-semibold">
                Deleting your account will permanently remove:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your profile and account information</li>
                <li>All patient records and medical data</li>
                <li>Visit notes and documentation</li>
                <li>Care plans and assessments</li>
                <li>Training records and certifications</li>
                <li>All other data associated with your account</li>
              </ul>
              <p className="text-red-600 font-semibold mt-4">
                ⚠️ This action cannot be undone. All data will be permanently deleted.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              How to Delete Your Account
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Log into your account</h3>
                  <p className="text-gray-600">
                    Sign in to CareMetric AI using your registered email and password.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Navigate to Settings</h3>
                  <p className="text-gray-600">
                    Go to your profile settings by clicking on the settings icon in the navigation menu.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Find the Danger Zone</h3>
                  <p className="text-gray-600">
                    Scroll down to the "Danger Zone" section at the bottom of the settings page.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  4
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Confirm deletion</h3>
                  <p className="text-gray-600">
                    Click "Delete My Account", type "DELETE" to confirm, and complete the process.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Need Help?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              If you're having trouble deleting your account or have questions about data retention, 
              please contact our support team.
            </p>
            <div className="space-y-2 text-sm text-gray-600">
              <p><strong>Email:</strong> support@caremetricai.com</p>
              <p><strong>Data Processing Time:</strong> Account deletion is processed immediately</p>
              <p><strong>Privacy Policy:</strong> <a href="/privacy-policy" className="text-blue-600 hover:underline">View our privacy policy</a></p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <Button
            size="lg"
            onClick={() => navigate(createPageUrl("Settings"))}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Go to Settings to Delete Account
          </Button>
        </div>
      </div>
    </div>
  );
}