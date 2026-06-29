import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Package, AlertTriangle, CheckCircle2,
  Plus, Edit2, Trash2, Loader2
} from "lucide-react";
import { toast } from "sonner";

export default function SupplyManagementDashboard() {
  const queryClient = useQueryClient();
  const [_editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [newSupply, setNewSupply] = useState({
    name: "",
    category: "consumable",
    current_quantity: 0,
    low_stock_threshold: 10,
    reorder_quantity: 25,
    unit: ""
  });

  const { data: supplies = [] } = useQuery({
    queryKey: ["supplies"],
    queryFn: () => base44.entities.SupplyItem.list(),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ["supply-alerts"],
    queryFn: () => base44.entities.SupplyLowStockAlert.filter({ status: "active" }),
  });

  const { data: usageLogs = [] } = useQuery({
    queryKey: ["supply-usage"],
    queryFn: () => base44.entities.SupplyUsageLog.filter({}, "-created_date", 50),
  });

  const createSupplyMutation = useMutation({
    mutationFn: (data) => base44.entities.SupplyItem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplies"] });
      setNewSupply({
        name: "",
        category: "consumable",
        current_quantity: 0,
        low_stock_threshold: 10,
        reorder_quantity: 25,
        unit: ""
      });
      setShowAdd(false);
      toast.success("Supply added");
    },
  });

  const _updateSupplyMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.SupplyItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplies"] });
      setEditingId(null);
      toast.success("Supply updated");
    },
  });

  const deleteSupplyMutation = useMutation({
    mutationFn: (id) => base44.entities.SupplyItem.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplies"] });
      toast.success("Supply deleted");
    },
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (id) => {
      // Record the real acknowledging user, not the literal string "current_user"
      // (which made the audit field useless for every acknowledgment).
      const me = await base44.auth.me().catch(() => null);
      return base44.entities.SupplyLowStockAlert.update(id, {
        status: "acknowledged",
        acknowledged_by: me?.email || "unknown",
        acknowledged_date: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supply-alerts"] });
      toast.success("Alert acknowledged");
    },
  });

  const filteredSupplies = supplies.filter((s) =>
    (s.name || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");

  const totalValue = supplies.reduce(
    (sum, s) => sum + (s.current_quantity * (s.cost_per_unit || 0)),
    0
  );

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-600">Total Items</div>
            <div className="text-2xl font-bold text-slate-900">{supplies.length}</div>
          </CardContent>
        </Card>

        <Card className={criticalAlerts.length > 0 ? "border-red-300 bg-red-50" : ""}>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-600 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Critical Alerts
            </div>
            <div className={`text-2xl font-bold ${criticalAlerts.length > 0 ? "text-red-600" : "text-slate-900"}`}>
              {criticalAlerts.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-600">Low Stock</div>
            <div className="text-2xl font-bold text-orange-600">{warningAlerts.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-slate-600">Inventory Value</div>
            <div className="text-2xl font-bold text-slate-900">${totalValue.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Alerts Banner */}
      {criticalAlerts.length > 0 && (
        <Alert className="bg-red-50 border-red-300">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription>
            <p className="font-semibold text-red-900 mb-2">
              {criticalAlerts.length} Critical Supply Alert{criticalAlerts.length > 1 ? "s" : ""}
            </p>
            <div className="space-y-1">
              {criticalAlerts.slice(0, 3).map((alert) => (
                <p key={alert.id} className="text-sm text-red-800">
                  • {alert.supply_name}: {alert.current_quantity} {supplies.find(s => s.id === alert.supply_id)?.unit || "units"} remaining
                </p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="inventory" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="usage">Usage History</TabsTrigger>
        </TabsList>

        {/* Inventory Tab */}
        <TabsContent value="inventory" className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search supplies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
            <Button onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Supply
            </Button>
          </div>

          {showAdd && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4 space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="Supply name"
                    value={newSupply.name}
                    onChange={(e) => setNewSupply({ ...newSupply, name: e.target.value })}
                    className="border rounded px-3 py-2"
                  />
                  <select
                    value={newSupply.category}
                    onChange={(e) => setNewSupply({ ...newSupply, category: e.target.value })}
                    className="border rounded px-3 py-2"
                  >
                    <option value="medication">Medication</option>
                    <option value="wound_care">Wound Care</option>
                    <option value="equipment">Equipment</option>
                    <option value="consumable">Consumable</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Unit (tablets, ml, boxes, etc.)"
                    value={newSupply.unit}
                    onChange={(e) => setNewSupply({ ...newSupply, unit: e.target.value })}
                    className="border rounded px-3 py-2"
                  />
                  <input
                    type="number"
                    placeholder="Current quantity"
                    value={newSupply.current_quantity}
                    onChange={(e) =>
                      setNewSupply({ ...newSupply, current_quantity: parseInt(e.target.value) || 0 })
                    }
                    className="border rounded px-3 py-2"
                  />
                  <input
                    type="number"
                    placeholder="Low stock threshold"
                    value={newSupply.low_stock_threshold}
                    onChange={(e) =>
                      setNewSupply({ ...newSupply, low_stock_threshold: parseInt(e.target.value) || 0 })
                    }
                    className="border rounded px-3 py-2"
                  />
                  <input
                    type="number"
                    placeholder="Reorder quantity"
                    value={newSupply.reorder_quantity}
                    onChange={(e) =>
                      setNewSupply({ ...newSupply, reorder_quantity: parseInt(e.target.value) || 0 })
                    }
                    className="border rounded px-3 py-2"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setShowAdd(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createSupplyMutation.mutate(newSupply)}
                    disabled={!newSupply.name || createSupplyMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {createSupplyMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      "Add Supply"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {filteredSupplies.map((supply) => {
              // Guard a 0 (or missing) threshold so the bar width isn't Infinity/NaN.
              const percentFull = supply.low_stock_threshold > 0
                ? (supply.current_quantity / supply.low_stock_threshold) * 100
                : (supply.current_quantity > 0 ? 100 : 0);
              const statusColor =
                supply.status === "out_of_stock"
                  ? "bg-red-100 text-red-800"
                  : supply.status === "low_stock"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-green-100 text-green-800";

              return (
                <Card key={supply.id}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h4 className="font-semibold text-slate-900">{supply.name}</h4>
                        <p className="text-sm text-slate-600">
                          {(supply.category || "").replace(/_/g, " ")} • {supply.unit}
                        </p>
                      </div>
                      <Badge className={statusColor}>{(supply.status || "unknown").replace("_", " ")}</Badge>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4 mb-3">
                      <div>
                        <p className="text-xs text-slate-500">Current Stock</p>
                        <p className="text-lg font-bold text-slate-900">
                          {supply.current_quantity} {supply.unit}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Low Stock Threshold</p>
                        <p className="text-lg font-bold text-orange-600">{supply.low_stock_threshold}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Reorder Qty</p>
                        <p className="text-lg font-bold text-blue-600">{supply.reorder_quantity}</p>
                      </div>
                    </div>

                    {/* Stock Level Bar */}
                    <div className="mb-3">
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            supply.status === "out_of_stock"
                              ? "bg-red-600"
                              : supply.status === "low_stock"
                              ? "bg-yellow-500"
                              : "bg-green-600"
                          }`}
                          style={{ width: `${Math.min(percentFull, 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingId(supply.id)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteSupplyMutation.mutate(supply.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts" className="space-y-3">
          {alerts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-slate-500">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
                <p>All supplies are in stock</p>
              </CardContent>
            </Card>
          ) : (
            alerts.map((alert) => (
              <Card key={alert.id} className={
                alert.severity === "critical"
                  ? "border-red-300 bg-red-50"
                  : alert.severity === "out_of_stock"
                  ? "border-red-300 bg-red-50"
                  : "border-yellow-300 bg-yellow-50"
              }>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900">{alert.supply_name}</h4>
                      <p className="text-sm text-slate-600">
                        Current: {alert.current_quantity} / Threshold: {alert.threshold_quantity}
                      </p>
                    </div>
                    <Badge className={
                      alert.severity === "critical" ? "bg-red-600" :
                      alert.severity === "out_of_stock" ? "bg-red-700" :
                      "bg-yellow-600"
                    }>
                      {(alert.severity || "").replace("_", " ")}
                    </Badge>
                  </div>

                  <p className="text-sm text-slate-700 mb-3">
                    Recommended reorder: {alert.recommended_reorder} units
                  </p>

                  {alert.reorder_task_created && (
                    <p className="text-xs text-green-700 mb-3">
                      ✓ Reorder task generated
                    </p>
                  )}

                  {alert.status === "active" && (
                    <Button
                      size="sm"
                      onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                      disabled={acknowledgeAlertMutation.isPending}
                    >
                      Acknowledge
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Usage Tab */}
        <TabsContent value="usage" className="space-y-3">
          {usageLogs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-slate-500">
                <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p>No supply usage recorded yet</p>
              </CardContent>
            </Card>
          ) : (
            usageLogs.slice(0, 20).map((log) => (
              <Card key={log.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900">{log.supply_name}</h4>
                      <p className="text-sm text-slate-600">
                        {log.quantity_used} {log.unit} • {log.usage_date}
                      </p>
                      {log.extracted_from_note && (
                        <Badge className="text-xs mt-1 bg-navy-100 text-navy-800">
                          Extracted from note ({log.extraction_confidence}%)
                        </Badge>
                      )}
                      {log.notes && (
                        <p className="text-xs text-slate-500 mt-2">{log.notes}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}