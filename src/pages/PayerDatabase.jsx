import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter, Phone, Globe, Building, CheckCircle, AlertCircle, DollarSign, Plus, Edit } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AvailityEligibilityChecker from "@/components/billing/AvailityEligibilityChecker";
import PayerFormDialog from "@/components/billing/PayerFormDialog";
import PayerDocumentManager from "@/components/billing/PayerDocumentManager";
import PayerFeedbackWidget from "@/components/billing/PayerFeedbackWidget";

export default function PayerDatabase() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPayerType, setFilterPayerType] = useState("all");
  const [filterProviderType, setFilterProviderType] = useState("all");
  const [filterState, setFilterState] = useState("all");
  const [selectedPayer, setSelectedPayer] = useState(null);
  const [showPayerForm, setShowPayerForm] = useState(false);
  const [editingPayer, setEditingPayer] = useState(null);

  const queryClient = useQueryClient();

  const { data: payers = [], isLoading } = useQuery({
    queryKey: ['payers'],
    queryFn: async () => {
      return await base44.entities.Payer.list('-payer_name', 500);
    }
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const filteredPayers = payers.filter(payer => {
    const matchesSearch = payer.payer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         payer.payer_id?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesPayerType = filterPayerType === "all" || payer.payer_type === filterPayerType;

    const matchesProviderType = filterProviderType === "all" || 
                                payer.applicable_provider_types?.includes(filterProviderType) ||
                                payer.applicable_provider_types?.includes("All");

    const matchesState = filterState === "all" || 
                        payer.states?.includes(filterState) ||
                        payer.states?.includes("All");

    const isActive = payer.is_active !== false;

    return matchesSearch && matchesPayerType && matchesProviderType && matchesState && isActive;
  });

  const usStates = [
    { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
    { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
    { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
    { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
    { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
    { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
    { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
    { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
    { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
    { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
    { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
    { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
    { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
    { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
    { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
    { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
    { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" }
  ];

  const getPayerTypeColor = (type) => {
    switch (type) {
      case "Medicare": return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
      case "Medicaid": return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
      case "Commercial": return "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200";
      case "Managed Care": return "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200";
      default: return "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200";
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Payer Database</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Comprehensive database of insurance payers with billing codes, requirements, and contact information
          </p>
        </div>
        <Button onClick={() => { setEditingPayer(null); setShowPayerForm(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Add Payer
        </Button>
      </div>

      {/* Availity Eligibility Checker */}
      <AvailityEligibilityChecker />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Search & Filter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Search Payer</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search by name or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div>
              <Label>State</Label>
              <Select value={filterState} onValueChange={setFilterState}>
                <SelectTrigger>
                  <SelectValue placeholder="All states" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="all">All States</SelectItem>
                  {usStates.map(state => (
                    <SelectItem key={state.code} value={state.code}>
                      {state.name} ({state.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Payer Type</Label>
              <Select value={filterPayerType} onValueChange={setFilterPayerType}>
                <SelectTrigger>
                  <SelectValue placeholder="All payer types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Medicare">Medicare</SelectItem>
                  <SelectItem value="Medicaid">Medicaid</SelectItem>
                  <SelectItem value="Commercial">Commercial</SelectItem>
                  <SelectItem value="Managed Care">Managed Care</SelectItem>
                  <SelectItem value="Workers Comp">Workers Comp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Provider Type</Label>
              <Select value={filterProviderType} onValueChange={setFilterProviderType}>
                <SelectTrigger>
                  <SelectValue placeholder="All providers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Providers</SelectItem>
                  <SelectItem value="RN">RN</SelectItem>
                  <SelectItem value="LPN">LPN</SelectItem>
                  <SelectItem value="NP">NP</SelectItem>
                  <SelectItem value="MD">MD</SelectItem>
                  <SelectItem value="DO">DO</SelectItem>
                  <SelectItem value="PA">PA</SelectItem>
                  <SelectItem value="PT">PT</SelectItem>
                  <SelectItem value="OT">OT</SelectItem>
                  <SelectItem value="ST">ST</SelectItem>
                  <SelectItem value="MSW">MSW</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>Showing {filteredPayers.length} of {payers.length} payers</span>
            {(searchTerm || filterPayerType !== "all" || filterProviderType !== "all" || filterState !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchTerm("");
                  setFilterPayerType("all");
                  setFilterProviderType("all");
                  setFilterState("all");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payers List and Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Payers List */}
        <div className="lg:col-span-1 space-y-3 max-h-[800px] overflow-y-auto">
          {isLoading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-slate-500">Loading payers...</p>
              </CardContent>
            </Card>
          ) : filteredPayers.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-slate-500">No payers found</p>
              </CardContent>
            </Card>
          ) : (
            filteredPayers.map((payer) => (
              <Card
                key={payer.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedPayer?.id === payer.id ? 'border-2 border-blue-500' : ''
                }`}
                onClick={() => setSelectedPayer(payer)}
              >
                <CardContent className="p-4">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm">{payer.payer_name}</h3>
                      <Badge className={getPayerTypeColor(payer.payer_type)}>
                        {payer.payer_type}
                      </Badge>
                    </div>
                    {payer.payer_id && (
                      <p className="text-xs text-slate-500">ID: {payer.payer_id}</p>
                    )}
                    {payer.states && payer.states.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {payer.states.includes("All") ? (
                          <Badge variant="secondary" className="text-xs">All States</Badge>
                        ) : (
                          payer.states.slice(0, 3).map((state, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{state}</Badge>
                          ))
                        )}
                        {payer.states.length > 3 && !payer.states.includes("All") && (
                          <Badge variant="secondary" className="text-xs">+{payer.states.length - 3}</Badge>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {payer.applicable_provider_types?.slice(0, 3).map((type, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {type}
                        </Badge>
                      ))}
                      {payer.applicable_provider_types?.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{payer.applicable_provider_types.length - 3}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Payer Details */}
        <div className="lg:col-span-2">
          {selectedPayer ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-2xl">{selectedPayer.payer_name}</CardTitle>
                    <CardDescription className="mt-2">
                      Payer ID: {selectedPayer.payer_id || 'Not specified'}
                    </CardDescription>
                  </div>
                  <Badge className={getPayerTypeColor(selectedPayer.payer_type)}>
                    {selectedPayer.payer_type}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex justify-end mb-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingPayer(selectedPayer);
                      setShowPayerForm(true);
                    }}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Payer
                  </Button>
                </div>
                <Tabs defaultValue="codes" className="w-full">
                  <TabsList className="grid w-full grid-cols-6">
                    <TabsTrigger value="codes">Billing Codes</TabsTrigger>
                    <TabsTrigger value="requirements">Requirements</TabsTrigger>
                    <TabsTrigger value="contact">Contact Info</TabsTrigger>
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="documents">Documents</TabsTrigger>
                    <TabsTrigger value="feedback">Feedback</TabsTrigger>
                  </TabsList>

                  {/* Billing Codes Tab */}
                  <TabsContent value="codes" className="space-y-4">
                    {selectedPayer.billing_codes && selectedPayer.billing_codes.length > 0 ? (
                      <div className="space-y-4">
                        {selectedPayer.billing_codes.map((code, idx) => (
                          <Card key={idx} className="border-l-4 border-l-blue-500">
                            <CardContent className="pt-4 space-y-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    <h4 className="font-semibold text-lg">{code.code}</h4>
                                    <Badge variant="outline">{code.code_type}</Badge>
                                  </div>
                                  <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {code.description}
                                  </p>
                                </div>
                                {code.reimbursement_rate && (
                                  <div className="text-right">
                                    <DollarSign className="w-4 h-4 text-green-600 inline" />
                                    <span className="text-sm font-medium text-green-600">
                                      {code.reimbursement_rate}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {code.requirements && code.requirements.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Requirements:
                                  </p>
                                  <ul className="space-y-1">
                                    {code.requirements.map((req, i) => (
                                      <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex gap-2">
                                        <CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0 mt-0.5" />
                                        {req}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {code.modifier_codes && code.modifier_codes.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Common Modifiers:
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {code.modifier_codes.map((mod, i) => (
                                      <Badge key={i} variant="outline" className="text-xs">
                                        {mod}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {code.frequency_limitations && (
                                <div className="bg-orange-50 dark:bg-orange-950 p-2 rounded">
                                  <p className="text-xs text-orange-800 dark:text-orange-200">
                                    <AlertCircle className="w-3 h-3 inline mr-1" />
                                    <strong>Frequency Limit:</strong> {code.frequency_limitations}
                                  </p>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                        No billing codes available for this payer
                      </div>
                    )}
                  </TabsContent>

                  {/* Requirements Tab */}
                  <TabsContent value="requirements" className="space-y-4">
                    <div className="space-y-4">
                      {selectedPayer.prior_authorization_required && (
                        <Card className="border-l-4 border-l-orange-500">
                          <CardContent className="pt-4">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-5 h-5 text-orange-600" />
                              <p className="font-medium">Prior Authorization Required</p>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {selectedPayer.timely_filing_limit_days && (
                        <Card>
                          <CardContent className="pt-4">
                            <p className="text-sm">
                              <strong>Timely Filing Limit:</strong> {selectedPayer.timely_filing_limit_days} days
                            </p>
                          </CardContent>
                        </Card>
                      )}

                      {selectedPayer.general_requirements && selectedPayer.general_requirements.length > 0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">General Requirements</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-2">
                              {selectedPayer.general_requirements.map((req, i) => (
                                <li key={i} className="text-sm flex gap-2">
                                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                  {req}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}

                      {selectedPayer.notes && (
                        <Card className="bg-blue-50 dark:bg-blue-950">
                          <CardContent className="pt-4">
                            <p className="text-sm text-blue-900 dark:text-blue-100">
                              <strong>Additional Notes:</strong> {selectedPayer.notes}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </TabsContent>

                  {/* Contact Info Tab */}
                  <TabsContent value="contact" className="space-y-4">
                    {selectedPayer.contact_info ? (
                      <div className="space-y-3">
                        {selectedPayer.contact_info.phone && (
                          <Card>
                            <CardContent className="pt-4 flex items-center gap-3">
                              <Phone className="w-5 h-5 text-blue-600" />
                              <div>
                                <p className="text-xs text-slate-500">Phone</p>
                                <p className="font-medium">{selectedPayer.contact_info.phone}</p>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {selectedPayer.contact_info.website && (
                          <Card>
                            <CardContent className="pt-4 flex items-center gap-3">
                              <Globe className="w-5 h-5 text-blue-600" />
                              <div>
                                <p className="text-xs text-slate-500">Website</p>
                                <a
                                  href={selectedPayer.contact_info.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-blue-600 hover:underline"
                                >
                                  {selectedPayer.contact_info.website}
                                </a>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {selectedPayer.contact_info.provider_portal && (
                          <Card>
                            <CardContent className="pt-4 flex items-center gap-3">
                              <Building className="w-5 h-5 text-blue-600" />
                              <div>
                                <p className="text-xs text-slate-500">Provider Portal</p>
                                <a
                                  href={selectedPayer.contact_info.provider_portal}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-blue-600 hover:underline"
                                >
                                  {selectedPayer.contact_info.provider_portal}
                                </a>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {selectedPayer.contact_info.claims_address && (
                          <Card>
                            <CardContent className="pt-4">
                              <p className="text-xs text-slate-500 mb-1">Claims Address</p>
                              <p className="text-sm whitespace-pre-wrap">
                                {selectedPayer.contact_info.claims_address}
                              </p>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                        No contact information available
                      </div>
                    )}
                  </TabsContent>

                  {/* Details Tab */}
                  <TabsContent value="details" className="space-y-4">
                    <Card>
                      <CardContent className="pt-4 space-y-3">
                        <div>
                          <p className="text-xs text-slate-500">Applicable Provider Types</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {selectedPayer.applicable_provider_types?.map((type, i) => (
                              <Badge key={i} variant="outline">
                                {type}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {selectedPayer.electronic_submission_id && (
                          <div>
                            <p className="text-xs text-slate-500">EDI Payer ID</p>
                            <p className="font-medium">{selectedPayer.electronic_submission_id}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Documents Tab */}
                  <TabsContent value="documents">
                    <PayerDocumentManager payerId={selectedPayer.id} />
                  </TabsContent>

                  {/* Feedback Tab */}
                  <TabsContent value="feedback">
                    <PayerFeedbackWidget payerId={selectedPayer.id} payerName={selectedPayer.payer_name} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Building className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">Select a payer to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Payer Form Dialog */}
      <PayerFormDialog
        open={showPayerForm}
        onOpenChange={setShowPayerForm}
        payer={editingPayer}
        onSuccess={() => {
          queryClient.invalidateQueries(['payers']);
          setShowPayerForm(false);
          setEditingPayer(null);
        }}
      />
    </div>
  );
}