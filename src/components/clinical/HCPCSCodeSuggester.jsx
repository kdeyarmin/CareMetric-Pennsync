import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Code2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

const CODE_TYPE_COLORS = {
  "j_code": "bg-purple-100 text-purple-800",
  "e_code": "bg-blue-100 text-blue-800",
  "l_code": "bg-green-100 text-green-800",
  "m_code": "bg-orange-100 text-orange-800",
  "s_code": "bg-pink-100 text-pink-800"
};

export default function HCPCSCodeSuggester({ hcpcsCodes = [] }) {
  const [copied, setCopied] = useState(null);

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    toast.success("Code copied");
    setTimeout(() => setCopied(null), 2000);
  };

  if (!hcpcsCodes || hcpcsCodes.length === 0) return null;

  return (
    <div className="border rounded-lg p-4 bg-purple-50">
      <h3 className="font-semibold text-purple-900 mb-3 flex items-center gap-2">
        <Code2 className="w-4 h-4" /> HCPCS Codes (Supplies & Devices)
      </h3>
      <div className="space-y-2">
        {hcpcsCodes.map((code, idx) => (
          <div key={idx} className="bg-white p-3 rounded border border-purple-200">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-bold text-lg text-purple-700">
                    {code.code}
                  </span>
                  {code.code_type && (
                    <Badge className={CODE_TYPE_COLORS[code.code_type] || "bg-gray-100"}>
                      {code.code_type.toUpperCase().replace("_", " ")}
                    </Badge>
                  )}
                  {code.confidence === "high" && (
                    <Badge variant="outline" className="text-xs text-green-700">
                      High Confidence
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-700">{code.description}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copyCode(code.code)}
                className="h-8 w-8"
              >
                {copied === code.code ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              {code.typical_cost && (
                <div className="bg-gray-50 p-2 rounded">
                  <p className="text-gray-600 font-semibold">Typical Cost</p>
                  <p className="text-gray-900">{code.typical_cost}</p>
                </div>
              )}
              {code.payer_notes && (
                <div className="bg-yellow-50 p-2 rounded col-span-2">
                  <p className="text-yellow-700 font-semibold">Payer Notes</p>
                  <p className="text-yellow-900">{code.payer_notes}</p>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-600 italic mt-2">
              <strong>Why:</strong> {code.rationale}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}