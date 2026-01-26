import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, RefreshCw, Trash2, DollarSign, Calendar, Copy, AlertCircle, Edit, Archive, Filter, ArrowUpDown, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function StripeSubscriptionManager() {
  const queryClient = useQueryClient();
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
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [bulkEditDialog, setBulkEditDialog] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({ active: null });
  const [duplicateDialog, setDuplicateDialog] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("created");
  const [sortOrder, setSortOrder] = useState("desc");

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

  // Fetch all prices for each product (including inactive)
  const { data: pricesByProduct = {}, refetch: refetchPrices } = useQuery({
    queryKey: ["stripePrices"],
    queryFn: async () => {
      const prices = {};
      for (const product of products) {
        try {
          const response = await base44.functions.invoke('stripeListPrices', { product_id: product.id });
          // Show ALL prices including inactive ones
          prices[product.id] = response?.data?.prices || [];
        } catch (error) {
          console.error(`Error fetching prices for ${product.id}:`, error);
          prices[product.id] = [];
        }
      }
      return prices;
    },
    enabled: products.length > 0,
    staleTime: 0,
    cacheTime: 0
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

    toast.loading("Deleting product...");
    
    try {
      const response = await base44.functions.invoke('stripeDeleteProduct', {
        product_id: productId
      });

      console.log('Full delete response:', response);
      
      toast.dismiss();
      
      // Check if deletion was successful
      if (response?.data?.success === true || response?.success === true) {
        toast.success("Product deleted successfully");
        await refetchProducts();
      } else {
        const errorMsg = response?.data?.error || response?.error || response?.details || "Failed to delete product";
        console.error('Delete failed:', errorMsg);
        toast.error(errorMsg);
      }
    } catch (error) {
      toast.dismiss();
      console.error('Delete error:', error);
      toast.error(error.message || "Failed to delete product");
    }
  };

  const handleTogglePriceStatus = async (priceId, currentStatus, priceLabel) => {
    const action = currentStatus ? "deactivate" : "activate";
    
    if (!confirm(`Are you sure you want to ${action} this price (${priceLabel})?`)) {
      return;
    }

    const toastId = toast.loading(`${action === 'deactivate' ? 'Deactivating' : 'Activating'} price...`);
    
    try {
      const response = await base44.functions.invoke('stripeDeletePrice', {
        price_id: priceId,
        set_active: !currentStatus
      });

      console.log('Toggle price response:', response);
      
      if (response?.data?.success === true || response?.success === true) {
        toast.success(`Price ${action}d successfully`, { id: toastId });
        queryClient.resetQueries({ queryKey: ['stripePrices'] });
        await refetchPrices();
      } else {
        const errorMsg = response?.data?.error || response?.error || response?.details || `Failed to ${action} price`;
        console.error('Toggle failed:', response);
        toast.error(errorMsg, { id: toastId });
      }
    } catch (error) {
      console.error('Toggle error:', error);
      toast.error(error.message || `Failed to ${action} price`, { id: toastId });
    }
  };

  const handleResetProducts = async () => {
    if (!confirm('⚠️ WARNING: This will DELETE ALL existing products and recreate them with the correct prices ($29.99, $81.99, $149.99, $264.99). This cannot be undone. Continue?')) {
      return;
    }

    setIsCleaningUp(true);
    const toastId = toast.loading('Deleting and recreating products...');

    try {
      const response = await base44.functions.invoke('resetStripeProducts', {});
      
      if (response?.data?.success === true || response?.success === true) {
        const deleted = response?.data?.deleted || 0;
        const created = response?.data?.created || [];
        toast.success(
          `Reset complete! Deleted ${deleted} products, created ${created.length} new products.`,
          { id: toastId, duration: 5000 }
        );
        queryClient.resetQueries({ queryKey: ['stripeProducts'] });
        queryClient.resetQueries({ queryKey: ['stripePrices'] });
        await refetchProducts();
      } else {
        toast.error('Failed to reset products', { id: toastId });
      }
    } catch (error) {
      console.error('Reset error:', error);
      toast.error(error.message || 'Failed to reset products', { id: toastId });
    } finally {
      setIsCleaningUp(false);
    }
  };

  const formatPrice = (cents) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getIntervalLabel = (interval, count) => {
    const times = count > 1 ? `${count} ` : "";
    return `${times}${interval}${count > 1 ? 's' : ''}`;
  };

  // Duplicate product handler
  const handleDuplicateProduct = async () => {
    if (!duplicateName.trim()) {
      toast.error("Product name is required");
      return;
    }

    try {
      // Create new product with same description
      const createResponse = await base44.functions.invoke('stripeCreateProduct', {
        name: duplicateName,
        description: duplicateSource.description || undefined
      });

      if (!createResponse?.data?.product?.id) {
        throw new Error("Failed to create product");
      }

      const newProductId = createResponse.data.product.id;

      // Duplicate all active prices from source product
      const sourcePrices = pricesByProduct[duplicateSource.id] || [];
      const activePrices = sourcePrices.filter(p => p.active);

      for (const price of activePrices) {
        await base44.functions.invoke('stripeCreatePrice', {
          product_id: newProductId,
          unit_amount: price.unit_amount,
          recurring_interval: price.recurring?.interval || "month",
          recurring_interval_count: price.recurring?.interval_count || 1,
          currency: 'usd'
        });
      }

      toast.success(`Product duplicated successfully with ${activePrices.length} prices!`);
      setDuplicateDialog(false);
      setDuplicateSource(null);
      setDuplicateName("");
      await refetchProducts();
    } catch (error) {
      toast.error(error.message || "Failed to duplicate product");
    }
  };

  // Bulk edit handler
  const handleBulkEdit = async () => {
    if (selectedProducts.length === 0) {
      toast.error("No products selected");
      return;
    }

    if (bulkEditData.active === null) {
      toast.error("Please select an action");
      return;
    }

    const toastId = toast.loading(`Updating ${selectedProducts.length} products...`);

    try {
      for (const productId of selectedProducts) {
        await base44.functions.invoke('stripeUpdateProduct', {
          product_id: productId,
          active: bulkEditData.active
        });
      }

      toast.success(`Updated ${selectedProducts.length} products successfully`, { id: toastId });
      setBulkEditDialog(false);
      setSelectedProducts([]);
      setBulkEditData({ active: null });
      await refetchProducts();
    } catch (error) {
      toast.error(error.message || "Failed to update products", { id: toastId });
    }
  };

  // Filter and sort products
  const filteredAndSortedProducts = useMemo(() => {
    let filtered = [...products];

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.description || "").toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (filterStatus !== "all") {
      filtered = filtered.filter(p => 
        filterStatus === "active" ? p.active : !p.active
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;

      if (sortBy === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === "created") {
        comparison = (a.created || 0) - (b.created || 0);
      } else if (sortBy === "price") {
        const pricesA = pricesByProduct[a.id] || [];
        const pricesB = pricesByProduct[b.id] || [];
        const minA = pricesA.length > 0 ? Math.min(...pricesA.map(p => p.unit_amount)) : 0;
        const minB = pricesB.length > 0 ? Math.min(...pricesB.map(p => p.unit_amount)) : 0;
        comparison = minA - minB;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [products, pricesByProduct, searchTerm, filterStatus, sortBy, sortOrder]);

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedProducts.length === filteredAndSortedProducts.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filteredAndSortedProducts.map(p => p.id));
    }
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
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Products & Pricing</h2>
            <div className="flex gap-2">
              {selectedProducts.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setBulkEditDialog(true)}
                  className="gap-2"
                >
                  <Edit className="w-4 h-4" />
                  Bulk Edit ({selectedProducts.length})
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={handleResetProducts}
                disabled={isCleaningUp}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {isCleaningUp ? "Resetting..." : "Reset All"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await refetchProducts();
                  await refetchPrices();
                }}
                disabled={loadingProducts}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loadingProducts ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Filters and Sorting */}
          <div className="flex flex-wrap gap-3 items-center bg-slate-50 dark:bg-slate-900 p-4 rounded-lg">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-white dark:bg-slate-800"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px] bg-white dark:bg-slate-800">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[140px] bg-white dark:bg-slate-800">
                <ArrowUpDown className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created">Created Date</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="price">Price</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            >
              {sortOrder === "asc" ? "↑" : "↓"}
            </Button>
          </div>

          {/* Select All Checkbox */}
          {filteredAndSortedProducts.length > 0 && (
            <div className="flex items-center gap-2 px-2">
              <Checkbox
                checked={selectedProducts.length === filteredAndSortedProducts.length}
                onCheckedChange={toggleSelectAll}
                id="select-all"
              />
              <Label htmlFor="select-all" className="text-sm cursor-pointer">
                Select All ({filteredAndSortedProducts.length})
              </Label>
              {selectedProducts.length > 0 && (
                <span className="text-sm text-blue-600">
                  {selectedProducts.length} selected
                </span>
              )}
            </div>
          )}
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
            {filteredAndSortedProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                <CardHeader className="bg-slate-50 dark:bg-slate-900 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 flex-1">
                      <Checkbox
                        checked={selectedProducts.includes(product.id)}
                        onCheckedChange={(checked) => {
                          setSelectedProducts(prev =>
                            checked
                              ? [...prev, product.id]
                              : prev.filter(id => id !== product.id)
                          );
                        }}
                      />
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDuplicateSource(product);
                          setDuplicateName(`${product.name} (Copy)`);
                          setDuplicateDialog(true);
                        }}
                        title="Duplicate product"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
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
                        <div key={price.id} className={`flex items-center justify-between p-3 rounded-lg ${price.active ? 'bg-gray-50 dark:bg-gray-800' : 'bg-gray-100 dark:bg-gray-900 opacity-60'}`}>
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
                            <Badge variant={price.active ? "default" : "secondary"} className="text-xs">
                              {price.active ? "Active" : "Inactive"}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {price.id}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(price.id, "Price ID")}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleTogglePriceStatus(price.id, price.active, `${formatPrice(price.unit_amount)}/${getIntervalLabel(price.recurring?.interval, price.recurring?.interval_count || 1)}`)}
                              className={price.active ? "text-red-600 hover:text-red-700 hover:bg-red-50" : "text-green-600 hover:text-green-700 hover:bg-green-50"}
                              title={price.active ? "Deactivate price" : "Activate price"}
                            >
                              <Archive className="w-4 h-4" />
                            </Button>
                          </div>
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