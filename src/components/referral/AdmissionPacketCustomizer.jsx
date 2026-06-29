import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, FileCode, Settings } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function AdmissionPacketCustomizer({ referralData, referralId }) {
  const [format, setFormat] = useState("pdf");
  const [isGenerating, setIsGenerating] = useState(false);
  const [sections, setSections] = useState({
    demographics: true,
    insurance: true,
    admission: true,
    diagnoses: true,
    medications: true,
    functional_status: true,
    clinical_info: true,
    skilled_needs: true,
    psychosocial: true,
    orders_treatments: true,
    safety_concerns: true,
    oasis_assessment: true,
    ai_risk_analysis: true,
    nursing_notes: true,
    homebound_status: true,
    sample_assessment: true,
    care_plans: true
  });

  const sectionLabels = {
    demographics: "Patient Demographics",
    insurance: "Insurance & Physicians",
    admission: "Admission Information",
    diagnoses: "Diagnoses & Medical History",
    medications: "Current Medications",
    functional_status: "Functional Status (OASIS-E)",
    clinical_info: "Clinical Information",
    skilled_needs: "Skilled Needs & Services",
    psychosocial: "Psychosocial Assessment",
    orders_treatments: "Physician Orders & Treatments",
    safety_concerns: "Safety Concerns",
    oasis_assessment: "Complete OASIS-E Assessment",
    ai_risk_analysis: "AI-Powered Risk Analysis",
    nursing_notes: "Important Nursing Notes",
    homebound_status: "Homebound Status Justification",
    sample_assessment: "Sample Admission Nursing Assessment",
    care_plans: "Suggested Care Plans"
  };

  const toggleSection = (section) => {
    setSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const selectAll = () => {
    const allSelected = {};
    Object.keys(sections).forEach(key => allSelected[key] = true);
    setSections(allSelected);
  };

  const deselectAll = () => {
    const allDeselected = {};
    Object.keys(sections).forEach(key => allDeselected[key] = false);
    setSections(allDeselected);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const selectedSections = Object.keys(sections).filter(key => sections[key]);

      if (selectedSections.length === 0) {
        toast.error("Please select at least one section");
        setIsGenerating(false);
        return;
      }

      if (format === "pdf") {
        const response = await base44.functions.invoke('generateReferralOASISPacket', {
          referralData,
          selectedSections
        });

        // Create download link
        const blob = new Blob([response.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `admission_packet_${referralId || Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        toast.success("PDF generated successfully!");
      } else if (format === "markdown") {
        const markdown = generateMarkdown(referralData, selectedSections);
        downloadFile(markdown, `admission_packet_${referralId || Date.now()}.md`, 'text/markdown');
        toast.success("Markdown file generated successfully!");
      } else if (format === "text") {
        const plainText = generatePlainText(referralData, selectedSections);
        downloadFile(plainText, `admission_packet_${referralId || Date.now()}.txt`, 'text/plain');
        toast.success("Text file generated successfully!");
      }
    } catch (error) {
      console.error('Generation error:', error);
      toast.error("Failed to generate admission packet");
    }
    setIsGenerating(false);
  };

  const downloadFile = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const generateMarkdown = (data, selectedSections) => {
    let markdown = "# PATIENT ADMISSION PACKET\n\n";
    markdown += "*Referral Summary & OASIS Pre-Assessment*\n\n";
    markdown += "---\n\n";

    if (selectedSections.includes('demographics') && data.demographics) {
      markdown += "## PATIENT DEMOGRAPHICS\n\n";
      const demo = data.demographics;
      if (demo.full_name) markdown += `**Full Name:** ${demo.full_name}\n\n`;
      if (demo.date_of_birth) markdown += `**Date of Birth:** ${demo.date_of_birth}\n\n`;
      if (demo.age) markdown += `**Age:** ${demo.age}\n\n`;
      if (demo.gender) markdown += `**Gender:** ${demo.gender}\n\n`;
      if (demo.address) markdown += `**Address:** ${demo.address}\n\n`;
      if (demo.phone) markdown += `**Phone:** ${demo.phone}\n\n`;
      if (demo.emergency_contact) markdown += `**Emergency Contact:** ${demo.emergency_contact}\n\n`;
      if (demo.emergency_phone) markdown += `**Emergency Phone:** ${demo.emergency_phone}\n\n`;
      markdown += "\n---\n\n";
    }

    if (selectedSections.includes('insurance') && data.demographics) {
      markdown += "## INSURANCE & PHYSICIANS\n\n";
      const demo = data.demographics;
      if (demo.insurance_primary) markdown += `**Primary Insurance:** ${demo.insurance_primary}\n\n`;
      if (demo.insurance_secondary) markdown += `**Secondary Insurance:** ${demo.insurance_secondary}\n\n`;
      if (demo.referring_physician) markdown += `**Referring Physician:** ${demo.referring_physician}\n\n`;
      if (demo.referring_physician_contact) markdown += `**Referring Physician Contact:** ${demo.referring_physician_contact}\n\n`;
      markdown += "\n---\n\n";
    }

    if (selectedSections.includes('diagnoses') && data.diagnoses) {
      markdown += "## DIAGNOSES & MEDICAL HISTORY\n\n";
      const dx = data.diagnoses;
      if (dx.primary_diagnosis) markdown += `### Primary Diagnosis\n\n**${dx.primary_diagnosis}**\n\n`;
      if (dx.secondary_diagnoses?.length > 0) {
        markdown += `### Secondary Diagnoses\n\n`;
        dx.secondary_diagnoses.forEach((d, i) => markdown += `${i + 1}. ${d}\n`);
        markdown += "\n";
      }
      if (dx.allergies) markdown += `**⚠️ ALLERGIES:** ${dx.allergies}\n\n`;
      markdown += "\n---\n\n";
    }

    if (selectedSections.includes('medications') && data.medications?.length > 0) {
      markdown += "## CURRENT MEDICATIONS\n\n";
      data.medications.forEach((med, i) => {
        markdown += `### ${i + 1}. ${med.name}\n`;
        if (med.dosage) markdown += `- **Dosage:** ${med.dosage}\n`;
        if (med.frequency) markdown += `- **Frequency:** ${med.frequency}\n`;
        if (med.route) markdown += `- **Route:** ${med.route}\n`;
        if (med.prescriber) markdown += `- **Prescriber:** ${med.prescriber}\n`;
        markdown += "\n";
      });
      markdown += "\n---\n\n";
    }

    if (selectedSections.includes('functional_status') && data.functional_status) {
      markdown += "## FUNCTIONAL STATUS (OASIS-E RELEVANT)\n\n";
      const func = data.functional_status;
      if (func.ambulation) markdown += `**Ambulation:** ${func.ambulation}\n\n`;
      if (func.adl_status) markdown += `**ADL Status:** ${func.adl_status}\n\n`;
      if (func.fall_risk) markdown += `**Fall Risk:** ${func.fall_risk}\n\n`;
      if (func.cognitive_status) markdown += `**Cognitive Status:** ${func.cognitive_status}\n\n`;
      markdown += "\n---\n\n";
    }

    if (selectedSections.includes('ai_risk_analysis')) {
      markdown += "## AI-POWERED RISK ANALYSIS\n\n";
      markdown += "*Risk analysis will be included in generated document*\n\n";
      markdown += "\n---\n\n";
    }

    return markdown;
  };

  const generatePlainText = (data, selectedSections) => {
    let text = "PATIENT ADMISSION PACKET\n";
    text += "Referral Summary & OASIS Pre-Assessment\n";
    text += "=".repeat(60) + "\n\n";

    if (selectedSections.includes('demographics') && data.demographics) {
      text += "PATIENT DEMOGRAPHICS\n" + "-".repeat(60) + "\n\n";
      const demo = data.demographics;
      if (demo.full_name) text += `Full Name: ${demo.full_name}\n`;
      if (demo.date_of_birth) text += `Date of Birth: ${demo.date_of_birth}\n`;
      if (demo.age) text += `Age: ${demo.age}\n`;
      if (demo.gender) text += `Gender: ${demo.gender}\n`;
      if (demo.address) text += `Address: ${demo.address}\n`;
      if (demo.phone) text += `Phone: ${demo.phone}\n`;
      if (demo.emergency_contact) text += `Emergency Contact: ${demo.emergency_contact}\n`;
      if (demo.emergency_phone) text += `Emergency Phone: ${demo.emergency_phone}\n`;
      text += "\n";
    }

    if (selectedSections.includes('insurance') && data.demographics) {
      text += "INSURANCE & PHYSICIANS\n" + "-".repeat(60) + "\n\n";
      const demo = data.demographics;
      if (demo.insurance_primary) text += `Primary Insurance: ${demo.insurance_primary}\n`;
      if (demo.insurance_secondary) text += `Secondary Insurance: ${demo.insurance_secondary}\n`;
      if (demo.referring_physician) text += `Referring Physician: ${demo.referring_physician}\n`;
      if (demo.referring_physician_contact) text += `Contact: ${demo.referring_physician_contact}\n`;
      text += "\n";
    }

    if (selectedSections.includes('diagnoses') && data.diagnoses) {
      text += "DIAGNOSES & MEDICAL HISTORY\n" + "-".repeat(60) + "\n\n";
      const dx = data.diagnoses;
      if (dx.primary_diagnosis) text += `PRIMARY DIAGNOSIS: ${dx.primary_diagnosis}\n\n`;
      if (dx.secondary_diagnoses?.length > 0) {
        text += `Secondary Diagnoses:\n`;
        dx.secondary_diagnoses.forEach((d, i) => text += `  ${i + 1}. ${d}\n`);
        text += "\n";
      }
      if (dx.allergies) text += `WARNING - ALLERGIES: ${dx.allergies}\n\n`;
    }

    if (selectedSections.includes('medications') && data.medications?.length > 0) {
      text += "CURRENT MEDICATIONS\n" + "-".repeat(60) + "\n\n";
      data.medications.forEach((med, i) => {
        text += `${i + 1}. ${med.name}\n`;
        if (med.dosage) text += `   Dosage: ${med.dosage}\n`;
        if (med.frequency) text += `   Frequency: ${med.frequency}\n`;
        if (med.route) text += `   Route: ${med.route}\n`;
        if (med.prescriber) text += `   Prescriber: ${med.prescriber}\n`;
        text += "\n";
      });
    }

    if (selectedSections.includes('functional_status') && data.functional_status) {
      text += "FUNCTIONAL STATUS (OASIS-E RELEVANT)\n" + "-".repeat(60) + "\n\n";
      const func = data.functional_status;
      if (func.ambulation) text += `Ambulation: ${func.ambulation}\n`;
      if (func.adl_status) text += `ADL Status: ${func.adl_status}\n`;
      if (func.fall_risk) text += `Fall Risk: ${func.fall_risk}\n`;
      if (func.cognitive_status) text += `Cognitive Status: ${func.cognitive_status}\n`;
      text += "\n";
    }

    return text;
  };

  return (
    <Card className="modern-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" />
          Customize Admission Packet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Format Selection */}
        <div>
          <Label className="text-base font-semibold mb-2 block">Output Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  PDF (Formatted Document)
                </div>
              </SelectItem>
              <SelectItem value="markdown">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4" />
                  Markdown (.md)
                </div>
              </SelectItem>
              <SelectItem value="text">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Plain Text (.txt)
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Section Selection */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-base font-semibold">Select Sections to Include</Label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto border rounded-lg p-4">
            {Object.entries(sectionLabels).map(([key, label]) => (
              <div key={key} className="flex items-center space-x-2">
                <Checkbox
                  id={key}
                  checked={sections[key]}
                  onCheckedChange={() => toggleSection(key)}
                />
                <Label
                  htmlFor={key}
                  className="text-sm cursor-pointer flex-1"
                >
                  {label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">
            <strong>{Object.values(sections).filter(Boolean).length}</strong> of {Object.keys(sections).length} sections selected
          </p>
          <p className="text-xs text-blue-700 mt-1">
            Format: <strong className="uppercase">{format}</strong>
          </p>
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || Object.values(sections).filter(Boolean).length === 0}
          className="w-full bg-blue-600 hover:bg-blue-700"
          size="lg"
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              Generating...
            </>
          ) : (
            <>
              <Download className="w-5 h-5 mr-2" />
              Generate {format.toUpperCase()} Admission Packet
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}