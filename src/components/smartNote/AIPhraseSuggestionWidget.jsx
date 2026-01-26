import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Plus, X, Loader2, TrendingUp, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function AIPhraseSuggestionWidget({ providerType, currentUser }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestedPhrases, setSuggestedPhrases] = useState([]);
  const [addedPhrases, setAddedPhrases] = useState(new Set());
  const queryClient = useQueryClient();

  const analyzePhrases = async () => {
    setAnalyzing(true);
    try {
      const response = await base44.functions.invoke('analyzeAndSuggestPhrases', {
        provider_type: providerType,
        min_occurrences: 3
      });

      const data = response.data || response;
      setSuggestedPhrases(data.suggested_phrases || []);
      
      if (data.suggested_phrases?.length > 0) {
        toast.success(`Found ${data.suggested_phrases.length} frequently used phrases!`);
      } else {
        toast.info(data.message || 'No new phrases detected yet. Keep documenting!');
      }
    } catch (error) {
      console.error('Error analyzing phrases:', error);
      toast.error('Failed to analyze phrase patterns');
    } finally {
      setAnalyzing(false);
    }
  };

  const addPhraseToLibrary = async (phrase, isShared = false) => {
    try {
      await base44.entities.SharedPhraseLibrary.create({
        phrase_name: phrase.phrase_name,
        phrase_content: phrase.phrase_content,
        category: phrase.category,
        tags: phrase.suggested_tags || [],
        usage_count: 0,
        is_best_practice: false,
        created_by_role: providerType
      });

      setAddedPhrases(prev => new Set([...prev, phrase.phrase_name]));
      queryClient.invalidateQueries({ queryKey: ['sharedPhrases'] });
      toast.success(`Added "${phrase.phrase_name}" to phrase library!`);
    } catch (error) {
      console.error('Error adding phrase:', error);
      toast.error('Failed to add phrase to library');
    }
  };

  const addAllPhrases = async () => {
    const notAdded = suggestedPhrases.filter(p => !addedPhrases.has(p.phrase_name));
    
    if (notAdded.length === 0) {
      toast.info('All phrases already added!');
      return;
    }

    try {
      const phrasesToCreate = notAdded.map(phrase => ({
        phrase_name: phrase.phrase_name,
        phrase_content: phrase.phrase_content,
        category: phrase.category,
        tags: phrase.suggested_tags || [],
        usage_count: 0,
        is_best_practice: false,
        created_by_role: providerType
      }));

      await base44.entities.SharedPhraseLibrary.bulkCreate(phrasesToCreate);
      
      notAdded.forEach(p => setAddedPhrases(prev => new Set([...prev, p.phrase_name])));
      queryClient.invalidateQueries({ queryKey: ['sharedPhrases'] });
      toast.success(`Added ${notAdded.length} phrases to your library!`);
    } catch (error) {
      console.error('Error adding phrases:', error);
      toast.error('Failed to add all phrases');
    }
  };

  const dismissPhrase = (phraseName) => {
    setSuggestedPhrases(prev => prev.filter(p => p.phrase_name !== phraseName));
    toast.success('Suggestion dismissed');
  };

  const categoryColors = {
    assessment: 'bg-blue-100 text-blue-800',
    intervention: 'bg-green-100 text-green-800',
    education: 'bg-purple-100 text-purple-800',
    homebound: 'bg-orange-100 text-orange-800',
    skilled_need: 'bg-red-100 text-red-800',
    vital_signs: 'bg-cyan-100 text-cyan-800',
    safety: 'bg-yellow-100 text-yellow-800',
    medication: 'bg-pink-100 text-pink-800',
    wound_care: 'bg-indigo-100 text-indigo-800'
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            AI Phrase Suggestions
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={analyzePhrases}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4 mr-2" />
                Analyze My Notes
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {suggestedPhrases.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Sparkles className="w-8 h-8 mx-auto mb-2 text-purple-300" />
            <p className="text-sm">Click "Analyze My Notes" to discover frequently used phrases</p>
            <p className="text-xs mt-1">AI will learn from your documentation patterns</p>
          </div>
        ) : (
          <>
            {/* Add All Button */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b">
              <p className="text-sm text-muted-foreground">
                {suggestedPhrases.length} phrases found • {addedPhrases.size} added
              </p>
              <Button
                size="sm"
                onClick={addAllPhrases}
                disabled={suggestedPhrases.length === addedPhrases.size}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add All Remaining
              </Button>
            </div>

            {/* Suggested Phrases List */}
            <ScrollArea className="h-[350px] pr-4">
              <div className="space-y-3">
                {suggestedPhrases.map((phrase, idx) => {
                  const isAdded = addedPhrases.has(phrase.phrase_name);
                  
                  return (
                    <div
                      key={idx}
                      className={`p-3 border rounded-lg transition-all ${
                        isAdded ? 'bg-green-50 dark:bg-green-950 border-green-200' : 'bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-sm truncate">{phrase.phrase_name}</h4>
                            <Badge className={categoryColors[phrase.category] || 'bg-gray-100 text-gray-800'}>
                              {phrase.category?.replace(/_/g, ' ')}
                            </Badge>
                            {phrase.occurrences && (
                              <Badge variant="outline" className="text-xs">
                                Used {phrase.occurrences}x
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-3">{phrase.phrase_content}</p>
                          {phrase.suggested_tags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {phrase.suggested_tags.map((tag, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {isAdded ? (
                            <Badge className="bg-green-100 text-green-800">
                              <Check className="w-3 h-3 mr-1" />
                              Added
                            </Badge>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => addPhraseToLibrary(phrase)}
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => dismissPhrase(phrase.phrase_name)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}