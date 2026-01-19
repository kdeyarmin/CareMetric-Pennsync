import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, RefreshCw, Trash2, DollarSign, Calendar, Copy, AlertCircle, Edit, Archive } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function StripeSubscriptionManager() {
  const [newProduct, setNewProduct] = useState({ name: "", description: "" });
  const [newPrice, setNewPrice] = useState({ 
    productId: "", 
    amount: "", 
    interval: "month",
    intervalCount: 1
  });
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [isCreatingPrice, setIsCreatingPrice] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editDialog, setEditDialog] = useState(false);

  // Fetch all products
  const { data: products = [], isLoading: loadingProducts, refetch: refetchProducts } = useQuery({
    queryKey: ["stripeProducts"],
    queryFn: async () => {
      try {
        const response = await base44.functions.invoke('stripeListProducts', {});
        return response?.data?.products || [];
      } catch (error) {
        console.error("Error fetching products:", error);
        return [];
      }
    }
  });

  // Fetch all prices for each product
  const { data: pricesByProduct = {} } = useQuery({
    queryKey: ["stripePrices", products],
    queryFn: async () => {
      const prices = {};
      for (const product of products) {
        try {
          const response = await base44.functions.invoke('stripeListPrices', { product_id: product.id });
          prices[product.id] = response?.data?.prices || [];
        } catch (error) {
          console.error(`Error fetching prices for ${product.id}:`, error);
          prices[product.id] = [];
        }
      }
      return prices;
    },
    enabled: products.length > 0
  });

  const handleCreateProduct = async () => {
    if (!newProduct.name.trim()) {
      toast.error("Product name is required");
      return;
    }

    setIsCreatingProduct(true);
    try {
      const response = await base44.functions.invoke('stripeCreateProduct', {
        name: newProduct.name,
        description: newProduct.description || undefined
      });

      if (response?.data?.product?.id) {
        toast.success("Product created successfully! Now add a price to it.");
        setNewProduct({ name: "", description: "" });
        
        // Refetch products and auto-select the new one
        await refetchProducts();
        setNewPrice({ ...newPrice, productId: response.data.product.id });
      } else {
        throw new Error("Failed to create product");
      }
    } catch (error) {
      toast.error(error.message || "Failed to create product");
    } finally {
      setIsCreatingProduct(false);
    }
  };

  const handleCreatePrice = async () => {
    if (!newPrice.productId || !newPrice.amount) {
      toast.error("Product and amount are required");
      return;
    }

    const amountCents = Math.round(parseFloat(newPrice.amount) * 100);
    if (isNaN(amountCents) || amountCents < 0) {
      toast.error("Invalid amount");
      return;
    }

    setIsCreatingPrice(true);
    try {
      const response = await base44.functions.invoke('stripeCreatePrice', {
        product_id: newPrice.productId,
        unit_amount: amountCents,
        recurring_interval: newPrice.interval,
        recurring_interval_count: parseInt(newPrice.intervalCount) || 1,
        currency: 'usd'
      });

      if (response?.data?.price) {
        toast.success("Price created successfully!");
        setNewPrice({ productId: "", amount: "", interval: "month", intervalCount: 1 });
        refetchProducts();
      } else {
        throw new Error("Failed to create price");
      }
    } catch (error) {
      toast.error(error.message || "Failed to create price");
    } finally {
      setIsCreatingPrice(false);
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleEditProduct = async () => {
    if (!editingProduct?.name?.trim()) {
      toast.error("Product name is required");
      return;
    }

    try {
      const response = await base44.functions.invoke('stripeUpdateProduct', {
        product_id: editingProduct.id,
        name: editingProduct.name,
        description: editingProduct.description,
        active: editingProduct.active
      });

      if (response?.data?.success) {
        toast.success("Product updated successfully");
        setEditDialog(false);
        setEditingProduct(null);
        refetchProducts();
      }
    } catch (error) {
      toast.error(error.message || "Failed to update product");
    }
  };

  const handleDeleteProduct = async (productId, productName) => {
    if (!confirm(`Are you sure you want to delete "${productName}"? This will also delete all associated prices.`)) {
      return;
    }

    try {
      const response = await base44.functions.invoke('stripeDeleteProduct', {
        product_id: productId
      });

      console.log('Delete response:', response);

      if (response?.success || response?.data?.success) {
        toast.success("Product deleted successfully");
        refetchProducts();
      } else {
        toast.error(response?.error || response?.data?.error || "Failed to delete product");
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error(error.message || "Failed to delete product");
    }
  };

  const formatPrice = (cents) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getIntervalLabel = (interval, count) => {
    const times = count > 1 ? `${count} ` : "";
    return `${times}${interval}${count > 1 ? 's' : ''}`;
  };

  return (
    <div className="space-y-6">
      <Alert>
        <AlertCircle className="w-4 h-4" />
        <AlertDescription>
          Manage your Stripe subscription products and pricing here. Changes will sync with your Stripe account.
        </AlertDescription>
      </Alert>

      {/* Create Product Section */}
      <Card>
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Create New Product
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <Label htmlFor="productName">Product Name</Label>
            <Input
              id="productName"
              placeholder="e.g., Premium Plan, 6 Month Subscription"
              value={newProduct.name}
              onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="productDesc">Description (Optional)</Label>
            <Input
              id="productDesc"
              placeholder="e.g., Access to all premium features"
              value={newProduct.description}
              onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
              className="mt-2"
            />
          </div>
          <Button
            onClick={handleCreateProduct}
            disabled={isCreatingProduct}
            className="bg-blue-600 hover:bg-blue-700 w-full"
          >
            {isCreatingProduct ? "Creating..." : "Create Product"}
          </Button>
        </CardContent>
      </Card>

      {/* Create Price Section */}
      <Card>
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Add Price to Product
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <Label htmlFor="selectProduct">Select Product</Label>
            <Select 
              value={newPrice.productId} 
              onValueChange={(value) => setNewPrice({ ...newPrice, productId: value })}
              onOpenChange={(open) => {
                if (open) {
                  refetchProducts(); // Refresh list when dropdown opens
                }
              }}
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Choose a product..." />
              </SelectTrigger>
              <SelectContent>
                {loadingProducts ? (
                  <SelectItem value="loading" disabled>Loading products...</SelectItem>
                ) : products.length === 0 ? (
                  <SelectItem value="none" disabled>No products yet - create one above</SelectItem>
                ) : (
                  products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input
                id="amount"
                type="number"
                placeholder="39.99"
                step="0.01"
                min="0"
                value={newPrice.amount}
                onChange={(e) => setNewPrice({ ...newPrice, amount: e.target.value })}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="interval">Billing Interval</Label>
              <Select value={newPrice.interval} onValueChange={(value) => setNewPrice({ ...newPrice, interval: value })}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="day">Day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="intervalCount">Repeat Every</Label>
              <Input
                id="intervalCount"
                type="number"
                placeholder="1"
                min="1"
                value={newPrice.intervalCount}
                onChange={(e) => setNewPrice({ ...newPrice, intervalCount: e.target.value })}
                className="mt-2"
              />
            </div>
          </div>

          <Button
            onClick={handleCreatePrice}
            disabled={isCreatingPrice || !newPrice.productId}
            className="bg-green-600 hover:bg-green-700 w-full"
          >
            {isCreatingPrice ? "Creating..." : "Add Price"}
          </Button>
        </CardContent>
      </Card>

      {/* Products & Prices List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Products & Pricing</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetchProducts()}
            disabled={loadingProducts}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loadingProducts ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loadingProducts ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              Loading products...
            </CardContent>
          </Card>
        ) : products.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              No products yet. Create one above to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {products.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                <CardHeader className="bg-slate-50 dark:bg-slate-900 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{product.name}</CardTitle>
                        <Badge variant={product.active ? "default" : "secondary"}>
                          {product.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      {product.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {product.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Dialog open={editDialog && editingProduct?.id === product.id} onOpenChange={(open) => {
                        setEditDialog(open);
                        if (!open) setEditingProduct(null);
                      }}>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingProduct(product)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Product</DialogTitle>
                            <DialogDescription>
                              Update product details
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 mt-4">
                            <div>
                              <Label>Product Name</Label>
                              <Input
                                value={editingProduct?.name || ""}
                                onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                                className="mt-2"
                              />
                            </div>
                            <div>
                              <Label>Description</Label>
                              <Input
                                value={editingProduct?.description || ""}
                                onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                                className="mt-2"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="active"
                                checked={editingProduct?.active ?? true}
                                onChange={(e) => setEditingProduct({ ...editingProduct, active: e.target.checked })}
                                className="w-4 h-4"
                              />
                              <Label htmlFor="active">Active</Label>
                            </div>
                            <Button onClick={handleEditProduct} className="w-full">
                              Save Changes
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteProduct(product.id, product.name)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {pricesByProduct[product.id]?.length > 0 ? (
                    <div className="space-y-2">
                      {pricesByProduct[product.id].map((price) => (
                        <div key={price.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <DollarSign className="w-4 h-4 text-green-600" />
                              <span className="font-semibold">
                                {formatPrice(price.unit_amount)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                              <Calendar className="w-4 h-4" />
                              {getIntervalLabel(price.recurring?.interval, price.recurring?.interval_count || 1)}
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {price.id}
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(price.id, "Price ID")}
                            className="flex-shrink-0"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No prices set yet. Add one above.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}