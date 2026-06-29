import React, { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";

export default function TemplateSearchFilter({ templates, onFilter }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);

  const categories = [...new Set(templates.map(t => t.template_category))];
  const statuses = ["active", "inactive"];

  const handleFilter = useCallback(() => {
    const filtered = templates.filter(template => {
      const matchesSearch = template.template_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           template.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = !selectedCategory || template.template_category === selectedCategory;
      const matchesStatus = !selectedStatus ||
                           (selectedStatus === "active" ? template.is_active : !template.is_active);

      return matchesSearch && matchesCategory && matchesStatus;
    });

    onFilter(filtered);
  }, [templates, searchQuery, selectedCategory, selectedStatus, onFilter]);

  React.useEffect(() => {
    handleFilter();
  }, [searchQuery, selectedCategory, selectedStatus, handleFilter]);

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setSelectedStatus(null);
  };

  const hasActiveFilters = searchQuery || selectedCategory || selectedStatus;

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-slate-50">
      <div>
        <label htmlFor="template-search" className="text-sm font-medium text-slate-700 block mb-2">Search Templates</label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input
            id="template-search"
            placeholder="Search by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div>
        <span className="text-sm font-medium text-slate-700 block mb-2">Category</span>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <Badge
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              className="cursor-pointer capitalize"
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            >
              {cat}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <span className="text-sm font-medium text-slate-700 block mb-2">Status</span>
        <div className="flex gap-2">
          {statuses.map(status => (
            <Badge
              key={status}
              variant={selectedStatus === status ? "default" : "outline"}
              className="cursor-pointer capitalize"
              onClick={() => setSelectedStatus(selectedStatus === status ? null : status)}
            >
              {status}
            </Badge>
          ))}
        </div>
      </div>

      {hasActiveFilters && (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={clearFilters}
          className="w-full text-red-600 hover:text-red-700"
        >
          <X className="w-4 h-4 mr-2" />
          Clear Filters
        </Button>
      )}
    </div>
  );
}