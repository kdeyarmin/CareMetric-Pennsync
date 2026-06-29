import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp, TrendingDown, AlertTriangle,
  Loader2, Search, RefreshCw, Package
} from "lucide-react";
import { toast } from "sonner";

export default function SupplyForecastDashboard() {
  const [searchPatient, setSearchPatient] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const queryClient = useQueryClient();

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.filter({ status: "active" }, "first_name", 100),
  });

  const { data: predictions = [] } = useQuery({
    queryKey: ["supply-predictions", selectedPatientId],
    queryFn: () =>
      selectedPatientId
        ? base44.entities.SupplyPrediction.filter({ patient_id: selectedPatientId }, "-estimated_days_until_reorder_needed")
        : Promise.resolve([]),
    enabled: !!selectedPatientId,
  });

  const generatePredictionsMutation = useMutation({
    // Call the real backend function, which authorizes the patient, analyzes
    // 6 months of usage logs and persists SupplyPrediction records. (Previously
    // this fired a freeform invokeLLM prompt and discarded the result, so the
    // button toasted "generated" without ever creating or refreshing anything.)
    mutationFn: (patientId) =>
      base44.functions.invoke('predictSupplyNeeds', { patientId }),
    onSuccess: (_data, patientId) => {
      queryClient.invalidateQueries({ queryKey: ["supply-predictions", patientId] });
      toast.success("Predictions generated");
    },
    onError: () => {
      toast.error("Failed to generate predictions");
    },
  });

  const filteredPatients = patients.filter(
    (p) =>
      `${p.first_name} ${p.last_name}`
        .toLowerCase()
        .includes(searchPatient.toLowerCase()) || p.medical_record_number?.includes(searchPatient)
  );

  const selectedPatient = patients.find(p => p.id === selectedPatientId);
  const urgentPredictions = predictions.filter(p => p.estimated_days_until_reorder_needed <= 14);
  const upcomingPredictions = predictions.filter(
    p => p.estimated_days_until_reorder_needed > 14 && p.estimated_days_until_reorder_needed <= 60
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient Selection */}
        <Card className="lg:row-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              Select Patient
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Name or MRN"
              value={searchPatient}
              onChange={(e) => setSearchPatient(e.target.value)}
            />
            <div className="max-h-96 overflow-y-auto space-y-2">
              {filteredPatients.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No patients found</p>
              ) : (
                filteredPatients.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      selectedPatientId === p.id
                        ? "border-blue-600 bg-blue-50"
                        : "border-slate-200 hover:border-blue-300 bg-white"
                    }`}
                  >
                    <p className="font-semibold text-sm text-slate-900">
                      {p.first_name} {p.last_name}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {p.medical_record_number && `MRN: ${p.medical_record_number}`}
                    </p>
                    {p.primary_diagnosis && (
                      <p className="text-xs text-slate-500 mt-1">{p.primary_diagnosis}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Stats */}
        {selectedPatient && (
          <>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-slate-600">Patient</p>
                <p className="text-lg font-bold text-slate-900 mt-1">
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </p>
                <p className="text-xs text-slate-500 mt-2">{selectedPatient.primary_diagnosis}</p>
              </CardContent>
            </Card>

            <Card className={urgentPredictions.length > 0 ? "border-red-300 bg-red-50" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Urgent Reorders</p>
                    <p className={`text-2xl font-bold mt-1 ${urgentPredictions.length > 0 ? "text-red-600" : "text-slate-900"}`}>
                      {urgentPredictions.length}
                    </p>
                  </div>
                  {urgentPredictions.length > 0 && (
                    <AlertTriangle className="w-8 h-8 text-red-600" />
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {selectedPatient && (
        <>
          {/* Predictions */}
          <Tabs defaultValue="urgent" className="w-full">
            <div className="flex justify-between items-center mb-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="urgent">Urgent ({urgentPredictions.length})</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming ({upcomingPredictions.length})</TabsTrigger>
                <TabsTrigger value="all">All ({predictions.length})</TabsTrigger>
              </TabsList>
              <Button
                onClick={() => generatePredictionsMutation.mutate(selectedPatientId)}
                disabled={generatePredictionsMutation.isPending}
                size="sm"
              >
                {generatePredictionsMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Regenerate
                  </>
                )}
              </Button>
            </div>

            <TabsContent value="urgent" className="space-y-3">
              {urgentPredictions.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-slate-500">
                    <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p>No urgent reorders at this time</p>
                  </CardContent>
                </Card>
              ) : (
                urgentPredictions.map((pred) => (
                  <PredictionCard key={pred.id} prediction={pred} urgent />
                ))
              )}
            </TabsContent>

            <TabsContent value="upcoming" className="space-y-3">
              {upcomingPredictions.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-slate-500">
                    <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p>No upcoming reorders scheduled</p>
                  </CardContent>
                </Card>
              ) : (
                upcomingPredictions.map((pred) => (
                  <PredictionCard key={pred.id} prediction={pred} />
                ))
              )}
            </TabsContent>

            <TabsContent value="all" className="space-y-3">
              {predictions.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-slate-500">
                    <Loader2 className="w-12 h-12 text-slate-300 mx-auto mb-3 animate-spin" />
                    <p>Generate predictions to see forecasts</p>
                  </CardContent>
                </Card>
              ) : (
                predictions.map((pred) => (
                  <PredictionCard
                    key={pred.id}
                    prediction={pred}
                    urgent={pred.estimated_days_until_reorder_needed <= 14}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function PredictionCard({ prediction, urgent }) {
  const daysColor =
    prediction.estimated_days_until_reorder_needed <= 7
      ? "text-red-600"
      : prediction.estimated_days_until_reorder_needed <= 14
      ? "text-orange-600"
      : "text-green-600";

  const trendIcon =
    prediction.usage_trend === "increasing" ? (
      <TrendingUp className="w-4 h-4 text-red-600" />
    ) : prediction.usage_trend === "decreasing" ? (
      <TrendingDown className="w-4 h-4 text-green-600" />
    ) : (
      <TrendingUp className="w-4 h-4 text-slate-400" />
    );

  return (
    <Card className={urgent ? "border-red-300 bg-red-50" : "border-slate-200"}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h4 className="font-semibold text-slate-900">{prediction.supply_name}</h4>
            <p className="text-sm text-slate-600 mt-1">
              Monthly Usage: {prediction.predicted_monthly_usage} units (trend: {prediction.usage_trend})
            </p>
          </div>
          <div className="flex items-center gap-2">
            {trendIcon}
            <Badge className={urgent ? "bg-red-600" : "bg-blue-100 text-blue-800"}>
              {prediction.confidence_score}% confidence
            </Badge>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3 mb-3 p-3 bg-white rounded-lg">
          <div>
            <p className="text-xs text-slate-500">Current Stock</p>
            <p className="text-lg font-bold text-slate-900">{prediction.current_inventory}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Recommended Order</p>
            <p className="text-lg font-bold text-blue-600">{prediction.recommended_quantity}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Days Until Reorder</p>
            <p className={`text-lg font-bold ${daysColor}`}>
              {prediction.estimated_days_until_reorder_needed} days
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Reorder Date</p>
            <p className="text-lg font-bold text-slate-900">
              {new Date(prediction.predicted_next_order_date).toLocaleDateString()}
            </p>
          </div>
        </div>

        {urgent && (
          <Alert className="bg-red-100 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">
              Place order immediately to avoid stockout
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}