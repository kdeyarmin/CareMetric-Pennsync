import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { Loader2, Upload, CheckCircle, FileText, AlertTriangle } from "lucide-react";

export default function AvailityPayerImporter() {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const availityPayersRaw = [
    { payer_id: "20446", payer_name: "6 DEGREES HEALTH INCORPORATED" },
    { payer_id: "68069", payer_name: "ABSOLUTE TOTAL CARE" },
    { payer_id: "AHS01", payer_name: "ACCESS ADMINISTRATOR" },
    { payer_id: "38254", payer_name: "ACTIVA BENEFIT SERVICES LLC" },
    { payer_id: "AHTP01", payer_name: "ADVENTHEALTH TRANSPLANT PROGRAM" },
    { payer_id: "VBBM13", payer_name: "ADVENTHEALTH VALUE BASED BUNDLE MANAGEMENT, LLC" },
    { payer_id: "65093", payer_name: "ADVOCATE HEALTH PARTNERS" },
    { payer_id: "36320", payer_name: "ADVOCATE MEDICAL GROUP" },
    { payer_id: "CB637", payer_name: "AEGIS ADMINISTRATIVE SERVICES" },
    { payer_id: "BC637", payer_name: "AEGIS ADMINISTRATIVE SERVICES" },
    { payer_id: "60054", payer_name: "AETNA AFFORDABLE HEALTH CHOICES (SM) SRC" },
    { payer_id: "60054", payer_name: "AETNA INSURANCE COMPANY" },
    { payer_id: "ARA01", payer_name: "AGERIGHT ADVANTAGE" },
    { payer_id: "85600", payer_name: "ALBUQUERQUE PUBLIC SCHOOLS" },
    { payer_id: "ASFL1", payer_name: "ALIGN SENIOR CARE (FLORIDA)" },
    { payer_id: "ASCA1", payer_name: "ALIGN SENIOR CARE CALIFORNIA" },
    { payer_id: "ASMI1", payer_name: "ALIGN SENIOR CARE MICHIGAN" },
    { payer_id: "ASVA1", payer_name: "ALIGN SENIOR CARE VIRGINIA" },
    { payer_id: "MRCHP", payer_name: "ALLCARE ADVANTAGE" },
    { payer_id: "MRIPA", payer_name: "ALLCARE HEALTH CCO" },
    { payer_id: "ACPCE", payer_name: "ALLCARE PACE" },
    { payer_id: "81040", payer_name: "ALLEGIANCE BENEFIT PLAN MANAGEMENT INCORPORATED" },
    { payer_id: "54398", payer_name: "ALLINA HEALTH AETNA" },
    { payer_id: "68069", payer_name: "AMBETTER" },
    { payer_id: "A2740", payer_name: "AMC PLUS" },
    { payer_id: "75137", payer_name: "AMERIBEN SOLUTIONS INCORPORATED" },
    { payer_id: "27517", payer_name: "AMERICAID COMMUNITY CARE (MARYLAND)" },
    { payer_id: "27516", payer_name: "AMERICAID COMMUNITY CARE (NEW JERSEY)" },
    { payer_id: "95606", payer_name: "AMERICAN PLAN ADMINISTRATORS" },
    { payer_id: "14163", payer_name: "AMERICAN PROGRESSIVE" },
    { payer_id: "ASH01", payer_name: "AMERICAN SPECIALTY HEALTH" },
    { payer_id: "26375", payer_name: "AMERIGROUP" },
    { payer_id: "WLPNT", payer_name: "AMERIGROUP - WELLPOINT" },
    { payer_id: "26374", payer_name: "AMERIGROUP HOUSTON" },
    { payer_id: "26378", payer_name: "AMERIGROUP MULTIPLE STATES" },
    { payer_id: "IHS10", payer_name: "ANCHOR (CLAIMSBRIDGE)" },
    { payer_id: "00601", payer_name: "ANTHEM - GA" },
    { payer_id: "00601", payer_name: "ANTHEM - GA (MEDICAID RECLAMATION)" },
    { payer_id: "47198", payer_name: "ANTHEM BC CALIFORNIA" },
    { payer_id: "47198", payer_name: "ANTHEM BC CALIFORNIA (MEDICAID RECLAMATION)" },
    { payer_id: "00050", payer_name: "ANTHEM BCBS COLORADO" },
    { payer_id: "00050", payer_name: "ANTHEM BCBS COLORADO (MEDICAID RECLAMATION)" },
    { payer_id: "00060", payer_name: "ANTHEM BCBS CONNECTICUT" },
    { payer_id: "00060", payer_name: "ANTHEM BCBS CONNECTICUT (MEDICAID RECLAMATION)" },
    { payer_id: "00630", payer_name: "ANTHEM BCBS INDIANA" },
    { payer_id: "00630", payer_name: "ANTHEM BCBS INDIANA (MEDICAID RECLAMATION)" },
    { payer_id: "00660", payer_name: "ANTHEM BCBS KENTUCKY" },
    { payer_id: "00660", payer_name: "ANTHEM BCBS KENTUCKY (MEDICAID RECLAMATION)" },
    { payer_id: "00680", payer_name: "ANTHEM BCBS MAINE" },
    { payer_id: "00680", payer_name: "ANTHEM BCBS MAINE (MEDICAID RECLAMATION)" },
    { payer_id: "00241", payer_name: "ANTHEM BCBS MISSOURI" },
    { payer_id: "00241", payer_name: "ANTHEM BCBS MISSOURI (MEDICAID RECLAMATION)" },
    { payer_id: "00265", payer_name: "ANTHEM BCBS NEVADA" },
    { payer_id: "00265", payer_name: "ANTHEM BCBS NEVADA (MEDICAID RECLAMATION)" },
    { payer_id: "00770", payer_name: "ANTHEM BCBS NEW HAMPSHIRE" },
    { payer_id: "00770", payer_name: "ANTHEM BCBS NEW HAMPSHIRE (MEDICAID RECLAMATION)" },
    { payer_id: "00834", payer_name: "ANTHEM BCBS OHIO" },
    { payer_id: "00834", payer_name: "ANTHEM BCBS OHIO (MEDICAID RECLAMATION)" },
    { payer_id: "00423", payer_name: "ANTHEM BCBS VIRGINIA" },
    { payer_id: "00423", payer_name: "ANTHEM BCBS VIRGINIA (MEDICAID RECLAMATION)" },
    { payer_id: "00950", payer_name: "ANTHEM BCBS WISCONSIN" },
    { payer_id: "00950", payer_name: "ANTHEM BCBS WISCONSIN (MEDICAID RECLAMATION)" },
    { payer_id: "00958", payer_name: "ANTHEM MAINE HEALTH" },
    { payer_id: "00265", payer_name: "ANTHEM MEDICAID NEVADA" },
    { payer_id: "61101", payer_name: "ARCADIAN MANAGEMENT SERVICES" },
    { payer_id: "68069", payer_name: "ARIZONA COMPLETE HEALTH" },
    { payer_id: "00520", payer_name: "ARKANSAS BCBS" },
    { payer_id: "68069", payer_name: "ARKANSAS TOTAL CARE" },
    { payer_id: "BCBSAZ", payer_name: "BCBS ARIZONA" },
    { payer_id: "00621", payer_name: "BCBS ILLINOIS" },
    { payer_id: "4716B", payer_name: "BCBS KANSAS" },
    { payer_id: "72107", payer_name: "BCBS LOUISIANA BLUE ADVANTAGE" },
    { payer_id: "SB700", payer_name: "BCBS MASSACHUSETTS" },
    { payer_id: "00710", payer_name: "BCBS MICHIGAN AND BLUE CARE NETWORK" },
    { payer_id: "00720", payer_name: "BCBS MINNESOTA" },
    { payer_id: "00751", payer_name: "BCBS MONTANA" },
    { payer_id: "00790", payer_name: "BCBS NEW MEXICO" },
    { payer_id: "55891", payer_name: "BCBS NORTH DAKOTA" },
    { payer_id: "00840", payer_name: "BCBS OKLAHOMA" },
    { payer_id: "84980", payer_name: "BCBS TEXAS" },
    { payer_id: "66001", payer_name: "BCBS TEXAS MEDICAID STAR CHIP" },
    { payer_id: "66001", payer_name: "BCBS TEXAS MEDICAID STAR Kids" },
    { payer_id: "53767", payer_name: "BCBS WYOMING" },
    { payer_id: "SB580", payer_name: "CAREFIRST BCBS DISTRICT OF COLUMBIA NCA" },
    { payer_id: "SB690", payer_name: "CAREFIRST BCBS MARYLAND" },
    { payer_id: "193", payer_name: "CAREFIRST MEDICARE ADVANTAGE" },
    { payer_id: "62308", payer_name: "CIGNA" },
    { payer_id: "62308", payer_name: "CIGNA ARIZONA MEDICARE ADVANTAGE" },
    { payer_id: "62308", payer_name: "CIGNA BEHAVIORAL HEALTH" },
    { payer_id: "52192", payer_name: "CIGNA HEALTHSPRING" },
    { payer_id: "00803R", payer_name: "EMPIRE BCBS - ANTHEM BCBS NY" },
    { payer_id: "00803", payer_name: "EMPIRE BCBS - ANTHEM BCBS NY" },
    { payer_id: "00803", payer_name: "EMPIRE BCBS - ANTHEM BCBS NY (MEDICAID RECLAMATION)" },
    { payer_id: "00590", payer_name: "FLORIDA BLUE (BCBS FLORIDA)" },
    { payer_id: "95567", payer_name: "HEALTH NET CLAIMS (CALIFORNIA OREGON)" },
    { payer_id: "22326", payer_name: "HORIZON NEW JERSEY HEALTH" },
    { payer_id: "61101", payer_name: "HUMANA" },
    { payer_id: "61102", payer_name: "HUMANA ENCOUNTERS" },
    { payer_id: "95348", payer_name: "HUMANA HEALTH PLANS OHIO" },
    { payer_id: "91051", payer_name: "KAISER FOUNDATION HEALTH PLAN WASHINGTON" },
    { payer_id: "64157", payer_name: "MERITAIN HEALTH" },
    { payer_id: "71412", payer_name: "MUTUAL OF OMAHA" },
    { payer_id: "14165", payer_name: "MVP HEALTH PLAN" },
    { payer_id: "00430", payer_name: "PREMERA BLUE CROSS (WA)" },
    { payer_id: "00934", payer_name: "PREMERA BLUE CROSS BLUE SHIELD OF ALASKA" },
    { payer_id: "00851", payer_name: "REGENCE BCBS OREGON" },
    { payer_id: "00910", payer_name: "REGENCE BCBS UTAH" },
    { payer_id: "00611", payer_name: "REGENCE BS IDAHO" },
    { payer_id: "00932", payer_name: "REGENCE BS WASHINGTON" },
    { payer_id: "80314", payer_name: "UNICARE" },
    { payer_id: "71412", payer_name: "UNITED OF OMAHA" },
    { payer_id: "14163", payer_name: "WELLCARE" },
    { payer_id: "68069", payer_name: "WELLCARE" },
    { payer_id: "14163", payer_name: "WELLCARE HEALTH PLANS" },
    { payer_id: "88848", payer_name: "WELLMARK BCBS (IOWA, SOUTH DAKOTA)" }
  ];

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const response = await base44.functions.invoke('importAvailityPayers', {
        payer_data_raw: availityPayersRaw
      });

      setResult(response.data);
    } catch (err) {
      console.error('Import error:', err);
      setError(err.message || 'Failed to import payers');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="border-indigo-200 dark:border-indigo-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-indigo-600" />
          Import Availity Payers
        </CardTitle>
        <CardDescription>
          Import payers from the Availity Essentials list with AI-powered categorization
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Alert>
          <FileText className="w-4 h-4" />
          <AlertDescription>
            This will import payers from the Availity Essentials Payer List. The AI will automatically categorize each payer by type and determine which states they operate in based on their name.
          </AlertDescription>
        </Alert>

        {result && (
          <Alert className="border-green-200 bg-green-50 dark:bg-green-950">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 dark:text-green-100">
              <div className="space-y-1">
                <p className="font-medium">{result.message}</p>
                <p className="text-sm">
                  • Total processed: {result.total_processed}
                </p>
                <p className="text-sm">
                  • New payers added: {result.new_payers_added}
                </p>
                <p className="text-sm">
                  • Duplicates skipped: {result.duplicates_skipped}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert className="border-red-200 bg-red-50 dark:bg-red-950">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 dark:text-red-100">
              {error}
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleImport}
          disabled={importing}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {importing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Importing & Categorizing Payers...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Import {availityPayersRaw.length} Availity Payers
            </>
          )}
        </Button>

        <p className="text-xs text-slate-500 text-center">
          AI will automatically determine payer type (Medicare, Medicaid, Commercial) and operating states for each payer
        </p>
      </CardContent>
    </Card>
  );
}