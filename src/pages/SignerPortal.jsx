import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { validateSignerToken } from '@/functions/validateSignerToken';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Lock, CheckCircle2 } from 'lucide-react';
import SignerPackageViewer from '@/components/signer/SignerPackageViewer';

export default function SignerPortal() {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [packageData, setPackageData] = useState(null);
  const [error, setError] = useState(null);
  const [isComplete, setIsComplete] = useState(false);

  const token = searchParams.get('token');

  const validateToken = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await validateSignerToken({ token });
      // functions.invoke returns the full axios response (interceptResponses:false);
      // the body is under .data. Reading response.valid directly always failed
      // (undefined), so the portal showed "invalid link" for every valid token.
      const result = response?.data || response;

      if (result.valid) {
        setIsValid(true);
        setPackageData(result);
      } else {
        setError(result.error || 'Invalid or expired access link.');
      }
    } catch (err) {
      setError(err.message || 'Failed to validate access link.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Final signature: the backend single-uses (deactivates) the token, so we must
  // NOT re-validate it (that would 403 → "Access Denied"). Show the completion
  // confirmation from the all_signed flag instead; any earlier signature just
  // refreshes the package status.
  const handleSignatureComplete = (allSigned) => {
    if (allSigned) {
      setIsComplete(true);
    } else {
      validateToken();
    }
  };

  useEffect(() => {
    if (!token) {
      setError('No access token provided. Please use the link from your email.');
      setIsLoading(false);
      return;
    }

    validateToken();
  }, [token, validateToken]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4" role="status">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
        <span className="sr-only">Validating access…</span>
      </div>
    );
  }



  if (isComplete) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4" role="status">
        <Card className="max-w-md w-full border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              All Documents Signed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 mb-4">
              Thank you — every document in this package has been signed. A copy and confirmation
              have been recorded for the document administrator.
            </p>
            <p className="text-xs text-slate-600">
              For your security this access link is now closed. You may close this window.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4" role="alert">
        <Card className="max-w-md w-full border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 mb-4">{error}</p>
            <p className="text-xs text-slate-600">
              If you believe this is an error, please contact the document administrator or try accessing the link again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isValid || !packageData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Public Portal Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Document Signing Portal</h1>
            <p className="text-sm text-slate-600">Secure access for authorized signers</p>
          </div>
          <div className="flex items-center gap-2 text-slate-600">
            <Lock className="w-4 h-4" />
            <span className="text-sm">Secure Session</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Greeting */}
        <Card className="mb-6 bg-navy-50 border-navy-200">
          <CardContent className="pt-6">
            <p className="text-sm">
              <span className="font-semibold text-slate-900">Hello {packageData.signerName},</span>
            </p>
            <p className="text-sm text-slate-700 mt-2">
              You have been invited to review and sign documents. Please complete all required signatures by{' '}
              <span className="font-medium">
                {new Date(packageData.dueDate).toLocaleDateString()}
              </span>
              .
            </p>
          </CardContent>
        </Card>

        {/* Package Status Overview */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{packageData.packageName}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {/* Total Documents */}
              <div className="text-center p-4 bg-slate-50 rounded-lg">
                <p className="text-2xl font-bold text-slate-900">
                  {(packageData.documents || []).length}
                </p>
                <p className="text-xs text-slate-600 mt-1">Total Documents</p>
              </div>

              {/* Signed Documents */}
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-600">
                  {(packageData.documents || []).filter((d) => ['signed', 'completed'].includes(d.status)).length}
                </p>
                <p className="text-xs text-slate-600 mt-1">Signed</p>
              </div>

              {/* Pending Documents */}
              <div className="text-center p-4 bg-amber-50 rounded-lg">
                <p className="text-2xl font-bold text-amber-600">
                  {(packageData.documents || []).filter((d) => !['signed', 'completed'].includes(d.status)).length}
                </p>
                <p className="text-xs text-slate-600 mt-1">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Document Viewer */}
        <SignerPackageViewer
          packageData={packageData}
          token={token}
          onSignatureComplete={handleSignatureComplete}
        />

        {/* Security Notice */}
        <Card className="mt-6 bg-slate-50">
          <CardContent className="pt-6">
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>Security Notice:</strong> This portal uses secure, token-based authentication to protect your sensitive information. Your signing activity is encrypted and logged for audit purposes. Do not share this link with others.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}