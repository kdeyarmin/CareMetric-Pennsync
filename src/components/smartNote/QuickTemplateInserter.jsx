import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Zap, Search, Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function QuickTemplateInserter({ 
  onInsert, 
  visitType, 
  providerType,
  currentNoteContent 
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Fetch document templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['documentTemplates'],
    queryFn: () => base44.entities.DocumentTemplate.list()
  });

  // Fetch shared phrases
  const { data: phrases = [], isLoading: phrasesLoading } = useQuery({
    queryKey: ['sharedPhrases'],
    queryFn: () => base44.entities.SharedPhraseLibrary.list()
  });

  // Filter templates by visit type, provider type, and search
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = !searchQuery || 
      template.template_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesVisitType = !visitType || template.visit_type === visitType || !template.visit_type;
    const matchesProviderType = !providerType || template.category?.toLowerCase().includes(providerType.toLowerCase());
    
    return matchesSearch && matchesVisitType && matchesProviderType;
  });

  // Filter phrases by category and search
  const filteredPhrases = phrases.filter(phrase => {
    const matchesSearch = !searchQuery || 
      phrase.phrase_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      phrase.phrase_content?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || phrase.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const handleInsertTemplate = async (template) => {
    if (!template.content) {
      toast.error('Template has no content');
      return;
    }

    // Update usage count
    try {
      await base44.entities.DocumentTemplate.update(template.id, {
        usage_count: (template.usage_count || 0) + 1
      });
    } catch (e) {
      console.error('Failed to update usage count:', e);
    }

    onInsert?.(template.content);
    toast.success(`Inserted template: ${template.template_name}`);
  };

  const handleInsertPhrase = async (phrase) => {
    if (!phrase.phrase_content) {
      toast.error('Phrase has no content');
      return;
    }

    // Update usage count
    try {
      await base44.entities.SharedPhraseLibrary.update(phrase.id, {
        usage_count: (phrase.usage_count || 0) + 1
      });
    } catch (e) {
      console.error('Failed to update usage count:', e);
    }

    // Insert phrase at cursor or append to note
    const insertion = currentNoteContent ? `${currentNoteContent}\n\n${phrase.phrase_content}` : phrase.phrase_content;
    onInsert?.(insertion);
    toast.success(`Inserted: ${phrase.phrase_name}`);
  };

  const phraseCategories = ['all', 'assessment', 'intervention', 'education', 'homebound', 'skilled_need', 'vital_signs', 'safety', 'medication', 'wound_care'];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Quick Templates & Phrases
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {filteredTemplates.length + filteredPhrases.length} available
          </Badge>
        </div>
        
        {/* Search Bar */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search templates and phrases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="templates" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="templates">
              <FileText className="w-4 h-4 mr-2" />
              Templates ({filteredTemplates.length})
            </TabsTrigger>
            <TabsTrigger value="phrases">
              <Zap className="w-4 h-4 mr-2" />
              Phrases ({filteredPhrases.length})
            </TabsTrigger>
          </TabsList>

          {/* Templates Tab */}
          <TabsContent value="templates" className="mt-4">
            {templatesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading templates...</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No templates found</div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-2">
                  {filteredTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="p-3 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group"
                      onClick={() => handleInsertTemplate(template)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-sm truncate">{template.template_name}</h4>
                            {template.usage_count > 0 && (
                              <Badge variant="outline" className="text-xs">
                                Used {template.usage_count}x
                              </Badge>
                            )}
                          </div>
                          {template.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{template.description}</p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {template.category && (
                              <Badge variant="secondary" className="text-xs">{template.category}</Badge>
                            )}
                            {template.visit_type && (
                              <Badge variant="outline" className="text-xs">{template.visit_type}</Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInsertTemplate(template);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* Phrases Tab */}
          <TabsContent value="phrases" className="mt-4">
            {/* Category Filter */}
            <div className="flex flex-wrap gap-1 mb-3">
              {phraseCategories.map(cat => (
                <Badge
                  key={cat}
                  variant={selectedCategory === cat ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>

            {phrasesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading phrases...</div>
            ) : filteredPhrases.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No phrases found</div>
            ) : (
              <ScrollArea className="h-[250px] pr-4">
                <div className="space-y-2">
                  {filteredPhrases.map((phrase) => (
                    <div
                      key={phrase.id}
                      className="p-3 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group"
                      onClick={() => handleInsertPhrase(phrase)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-sm truncate">{phrase.phrase_name}</h4>
                            {phrase.is_best_practice && (
                              <Badge className="text-xs bg-blue-100 text-blue-800">Best Practice</Badge>
                            )}
                            {phrase.usage_count > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {phrase.usage_count}x
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{phrase.phrase_content}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInsertPhrase(phrase);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}