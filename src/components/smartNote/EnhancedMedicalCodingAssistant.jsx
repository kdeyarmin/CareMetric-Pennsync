import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { Loader2, Copy, Plus, AlertCircle, CheckCircle2, Info, Search } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export default function EnhancedMedicalCodingAssistant({
  noteContent,
  diagnosis,
  procedures,
  patientAge,
  visitType,
  patientId,
  visitId,
  onCodesSelected
}) {
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState(null);
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const generateCodes = async () => {
    if (!noteContent || !diagnosis) {
      toast.error('Please enter note content and diagnosis');
      return;
    }

    setLoading(true);
    try {
      const response = await base44.functions.invoke('suggestMedicalCodesComprehensive', {
        note_content: noteContent,
        diagnosis,
        procedures,
        patient_age: patientAge,
        visit_type: visitType
      });

      if (response.data?.success) {
        setCodes(response.data);
        toast.success('Codes generated successfully!');
      } else {
        toast.error('Failed to generate codes');
      }
    } catch (error) {
      console.error('Error:', error);
      toast.error('Error generating codes');
    } finally {
      setLoading(false);
    }
  };

  const toggleCodeSelection = (type, index) => {
    const code = type === 'icd10' ? codes.icd10_codes[index] : codes.cpt_codes[index];
    const key = `${type}-${index}`;
    
    setSelectedCodes(prev => {
      const isSelected = prev.find(c => c.key === key);
      if (isSelected) {
        return prev.filter(c => c.key !== key);
      } else {
        return [...prev, { key, code, type }];
      }
    });
  };

  const insertCodes = async () => {
    if (selectedCodes.length === 0) {
      toast.error('Select at least one code');
      return;
    }

    setSaving(true);
    try {
      // Save codes to database with audit trail
      const response = await base44.functions.invoke('saveMedicalCodes', {
        patient_id: patientId,
        visit_id: visitId,
        codes: selectedCodes,
        note_excerpt: noteContent?.substring(0, 500)
      });

      if (response.data?.success) {
        onCodesSelected?.(selectedCodes);
        toast.success(`${selectedCodes.length} code(s) saved for review`);
      } else {
        toast.error('Failed to save codes');
      }
    } catch (error) {
      console.error('Error saving codes:', error);
      toast.error('Error saving codes');
    } finally {
      setSaving(false);
    }
  };

  const filteredIcd10 = codes?.icd10_codes?.filter(c =>
    searchTerm === '' || 
    c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.description.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const filteredCpt = codes?.cpt_codes?.filter(c =>
    searchTerm === '' || 
    c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.description.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="w-4 h-4 text-purple-600" />
          Medical Coding Assistant
        </CardTitle>
        <p className="text-xs text-gray-600 mt-1">ICD-10 & CPT Code Suggestions</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!codes ? (
          <Button
            onClick={generateCodes}
            disabled={loading || !noteContent || !diagnosis}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Generate Code Suggestions
              </>
            )}
          </Button>
        ) : (
          <AnimatePresence>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              {/* Summary */}
              {codes.coding_summary && (
                <div className="bg-white rounded-lg p-3 border border-purple-200">
                  <p className="text-xs text-gray-700">{codes.coding_summary}</p>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search codes by number or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Tabs */}
              <Tabs defaultValue="icd10" className="w-full">
                <TabsList className="grid w-full grid-cols-2 text-xs">
                  <TabsTrigger value="icd10">
                    ICD-10 ({filteredIcd10.length})
                  </TabsTrigger>
                  <TabsTrigger value="cpt">
                    CPT ({filteredCpt.length})
                  </TabsTrigger>
                </TabsList>

                {/* ICD-10 Codes */}
                <TabsContent value="icd10" className="space-y-2 mt-3">
                  {filteredIcd10.length > 0 ? (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {filteredIcd10.map((code, idx) => {
                        const isSelected = selectedCodes.some(c => c.key === `icd10-${idx}`);
                        return (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`border-2 rounded-lg p-2 cursor-pointer transition-all ${
                              isSelected
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-200 bg-white hover:border-purple-300'
                            }`}
                            onClick={() => toggleCodeSelection('icd10', idx)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <code className="text-xs font-bold text-purple-700">{code.code}</code>
                                  <Badge variant="outline" className="text-xs">
                                    {code.category}
                                  </Badge>
                                  <Badge
                                    className="text-xs"
                                    variant={code.specificity === 'high' ? 'default' : 'secondary'}
                                  >
                                    {code.specificity}
                                  </Badge>
                                </div>
                                <p className="text-xs text-gray-700 mt-1">{code.description}</p>
                                {code.explanation && (
                                  <p className="text-xs text-gray-600 mt-1 italic">
                                    {code.explanation}
                                  </p>
                                )}
                                {!code.billable && (
                                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    Non-billable (Use as secondary only)
                                  </p>
                                )}
                              </div>
                              {isSelected && (
                                <CheckCircle2 className="w-5 h-5 text-purple-600 flex-shrink-0 mt-1" />
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 text-center py-4">No codes found</p>
                  )}
                </TabsContent>

                {/* CPT Codes */}
                <TabsContent value="cpt" className="space-y-2 mt-3">
                  {filteredCpt.length > 0 ? (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {filteredCpt.map((code, idx) => {
                        const isSelected = selectedCodes.some(c => c.key === `cpt-${idx}`);
                        return (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`border-2 rounded-lg p-2 cursor-pointer transition-all ${
                              isSelected
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 bg-white hover:border-blue-300'
                            }`}
                            onClick={() => toggleCodeSelection('cpt', idx)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <code className="text-xs font-bold text-blue-700">{code.code}</code>
                                  {code.modifiers?.length > 0 && (
                                    <span className="text-xs text-gray-600">
                                      Modifiers: {code.modifiers.join(', ')}
                                    </span>
                                  )}
                                  {code.rvu && (
                                    <Badge variant="outline" className="text-xs">
                                      {code.rvu} RVU
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-gray-700 mt-1">{code.description}</p>
                                {code.explanation && (
                                  <p className="text-xs text-gray-600 mt-1 italic">
                                    {code.explanation}
                                  </p>
                                )}
                              </div>
                              {isSelected && (
                                <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1" />
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 text-center py-4">No codes found</p>
                  )}
                </TabsContent>
              </Tabs>

              {/* Action Bar */}
              <div className="border-t pt-3 space-y-2">
                {selectedCodes.length > 0 && (
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <p className="text-xs font-semibold text-blue-900 mb-2">
                      Selected: {selectedCodes.map(c => c.code.code).join(', ')}
                    </p>
                    <Button
                      onClick={insertCodes}
                      disabled={saving || !patientId}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3 mr-1" />
                          Save & Insert {selectedCodes.length} Code(s)
                        </>
                      )}
                    </Button>
                  </div>
                )}

                <Button
                  onClick={() => {
                    setCodes(null);
                    setSelectedCodes([]);
                    setSearchTerm('');
                  }}
                  variant="outline"
                  className="w-full text-xs h-8"
                >
                  Generate New Codes
                </Button>
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </CardContent>
    </Card>
  );
}