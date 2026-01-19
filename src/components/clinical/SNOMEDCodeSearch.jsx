import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Copy, Check, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function SNOMEDCodeSearch({ onCodeSelect, selectedCodes = [] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [copiedCode, setCopiedCode] = useState(null);

  const searchCodes = async (query) => {
    if (!query.trim() || query.length < 3) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const prompt = `Search for SNOMED-CT clinical codes related to: "${query}"

Return the top 10 most relevant SNOMED-CT codes with their descriptions.
Include both findings and disorders where applicable.

Format each result with:
- SNOMED code
- Full description
- Code type (finding/disorder/procedure)
- Common synonyms`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: {
            codes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  description: { type: 'string' },
                  type: { type: 'string' },
                  synonyms: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        }
      });

      setResults(response.codes || []);
    } catch (error) {
      console.error('Error searching codes:', error);
      toast.error('Failed to search codes');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      searchCodes(searchQuery);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success('Code copied to clipboard');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const isCodeSelected = (code) => {
    return selectedCodes.some(c => c.code === code);
  };

  const getTypeColor = (type) => {
    switch (type?.toLowerCase()) {
      case 'finding': return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
      case 'disorder': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
      case 'procedure': return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="w-5 h-5" />
          SNOMED-CT Code Search
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for clinical codes (e.g., chest pain, diabetes)"
            className="pl-10"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-3 w-4 h-4 animate-spin text-gray-400" />
          )}
        </div>

        {searchQuery.length > 0 && searchQuery.length < 3 && (
          <p className="text-sm text-gray-500 text-center">
            Type at least 3 characters to search
          </p>
        )}

        {results.length > 0 && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {results.map((result, idx) => (
              <div
                key={idx}
                className={`p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                  isCodeSelected(result.code) ? 'border-green-500 bg-green-50 dark:bg-green-950' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono font-bold text-sm">{result.code}</code>
                      <Badge className={getTypeColor(result.type)}>
                        {result.type}
                      </Badge>
                      {isCodeSelected(result.code) && (
                        <Badge variant="default" className="bg-green-600">
                          <Check className="w-3 h-3 mr-1" />
                          Selected
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{result.description}</p>
                    {result.synonyms?.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        Also known as: {result.synonyms.slice(0, 3).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCopyCode(result.code)}
                    >
                      {copiedCode === result.code ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant={isCodeSelected(result.code) ? "secondary" : "default"}
                      onClick={() => onCodeSelect?.(result)}
                      disabled={isCodeSelected(result.code)}
                    >
                      {isCodeSelected(result.code) ? (
                        <>
                          <Check className="w-4 h-4 mr-1" />
                          Added
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-1" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {searchQuery.length >= 3 && !searching && results.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">
            No codes found. Try a different search term.
          </p>
        )}
      </CardContent>
    </Card>
  );
}