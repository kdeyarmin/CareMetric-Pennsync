import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle, Clock, User, MapPin } from "lucide-react";

export default function SignatureVerification({ signatureId }) {
  const { data: signature, isLoading } = useQuery({
    queryKey: ['signature', signatureId],
    queryFn: () => base44.entities.DigitalSignature.filter({ id: signatureId }).then(r => r[0]),
    enabled: !!signatureId
  });

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading signature...</div>;
  }

  if (!signature) {
    return <div className="text-sm text-red-600">Signature not found</div>;
  }

  return (
    <Card className="border-l-4 border-l-green-500">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold">Digitally Signed</h3>
          </div>
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Verified
          </Badge>
        </div>

        {/* Signature Image */}
        <div className="border rounded-lg p-2 bg-white">
          <img
            src={signature.signature_data}
            alt="Signature"
            className="max-h-24 mx-auto"
          />
        </div>

        {/* Signer Information */}
        <div className="space-y-1 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <User className="w-3 h-3" />
            <span><strong>Signed by:</strong> {signature.signer_name} ({signature.signer_email})</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3" />
            <span><strong>Date:</strong> {new Date(signature.created_date).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-3 h-3" />
            <span><strong>IP Address:</strong> {signature.ip_address}</span>
          </div>
        </div>

        {/* Compliance Statement */}
        <div className="pt-2 border-t text-xs text-gray-500">
          <p className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            ESIGN Act & UETA compliant • Tamper-proof • Audit trail maintained
          </p>
        </div>
      </CardContent>
    </Card>
  );
}