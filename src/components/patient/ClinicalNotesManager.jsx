import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Edit2, Save, X, FileText, Calendar, User } from "lucide-react";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ClinicalNotesManager({ patient, onSave }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editedNotes, setEditedNotes] = useState(patient?.clinical_notes || "");
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Parse clinical notes into structured entries (if they follow a pattern)
  const parseNotesHistory = () => {
    const notesText = patient?.clinical_notes || "";
    if (!notesText) return [];

    // Try to parse notes that follow a date-stamped format
    const datePattern = /\[(\d{4}-\d{2}-\d{2}.*?)\]/g;
    const parts = notesText.split(datePattern).filter(Boolean);
    
    const entries = [];
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i + 1]) {
        entries.push({
          timestamp: parts[i],
          content: parts[i + 1].trim()
        });
      }
    }

    // If no structured entries found, return the whole text as one entry
    if (entries.length === 0 && notesText.trim()) {
      entries.push({
        timestamp: "Legacy Notes",
        content: notesText
      });
    }

    return entries.reverse(); // Most recent first
  };

  const notesHistory = parseNotesHistory();

  // Filter notes based on search query
  const filteredNotes = searchQuery.trim()
    ? notesHistory.filter(note =>
        note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.timestamp.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : notesHistory;

  const handleSave = () => {
    onSave({ clinical_notes: editedNotes });
    setIsEditing(false);
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;

    const timestamp = format(new Date(), "yyyy-MM-dd HH:mm");
    const currentUser = patient?.created_by || "User";
    const noteEntry = `\n\n[${timestamp} - ${currentUser}]\n${newNote.trim()}`;
    
    const updatedNotes = (patient?.clinical_notes || "") + noteEntry;
    
    onSave({ clinical_notes: updatedNotes });
    setNewNote("");
    setIsAddingNote(false);
  };

  const handleCancel = () => {
    setEditedNotes(patient?.clinical_notes || "");
    setIsEditing(false);
  };

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader className="p-3 sm:p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Clinical Notes
          </CardTitle>
          <div className="flex items-center gap-2">
            {!isEditing && !isAddingNote && (
              <>
                <Button
                  size="sm"
                  onClick={() => setIsAddingNote(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Note
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit2 className="w-4 h-4 mr-1" />
                  Edit All
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Search Bar */}
        {!isEditing && !isAddingNote && notesHistory.length > 0 && (
          <div className="mt-3 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search clinical notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
            {searchQuery && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 transform -translate-y-1/2"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-3 sm:p-4">
        {/* Add New Note Form */}
        {isAddingNote && (
          <Card className="mb-4 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
            <CardContent className="p-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  New Clinical Note
                </label>
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Enter clinical observations, assessments, or updates..."
                  className="min-h-[120px]"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Note
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsAddingNote(false);
                    setNewNote("");
                  }}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Edit Mode - Full Text Editor */}
        {isEditing && (
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                Edit all clinical notes below. Changes will replace the current notes.
              </AlertDescription>
            </Alert>
            <Textarea
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              className="min-h-[300px] font-mono text-sm"
              placeholder="Enter clinical notes..."
            />
            <div className="flex gap-2">
              <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* View Mode - Structured Notes Display */}
        {!isEditing && !isAddingNote && (
          <>
            {searchQuery && (
              <div className="mb-3">
                <Badge variant="outline" className="text-xs">
                  Found {filteredNotes.length} result{filteredNotes.length !== 1 ? 's' : ''}
                </Badge>
              </div>
            )}

            {filteredNotes.length === 0 && searchQuery ? (
              <div className="text-center py-8 text-gray-500">
                <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p>No notes found matching "{searchQuery}"</p>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="mb-2">No clinical notes recorded yet</p>
                <Button
                  size="sm"
                  onClick={() => setIsAddingNote(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Note
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {filteredNotes.map((note, index) => (
                    <Card
                      key={index}
                      className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow"
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Calendar className="w-3 h-3" />
                            <span className="font-medium">{note.timestamp}</span>
                          </div>
                        </div>
                        <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                          {searchQuery ? (
                            // Highlight search matches
                            note.content.split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) =>
                              part.toLowerCase() === searchQuery.toLowerCase() ? (
                                <mark key={i} className="bg-yellow-200 dark:bg-yellow-800">
                                  {part}
                                </mark>
                              ) : (
                                part
                              )
                            )
                          ) : (
                            note.content
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}