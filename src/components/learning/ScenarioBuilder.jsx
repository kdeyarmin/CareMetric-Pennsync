import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ChevronRight, Copy } from 'lucide-react';

export default function ScenarioBuilder({ courseId, onSave }) {
  const [scenario, setScenario] = useState({
    title: '',
    description: '',
    patientContext: '',
    difficulty: 'intermediate',
    estimatedMinutes: 15,
    learningObjectives: [],
    passingScore: 80,
    scenarioFlow: {
      id: 'node-start',
      text: 'Start: Present patient context here',
      feedback: '',
      type: 'decision',
      choices: [
        { text: 'Option A', feedback: '', isCorrect: false, nextNodeId: null },
        { text: 'Option B', feedback: '', isCorrect: false, nextNodeId: null }
      ]
    }
  });

  const [selectedNodeId, setSelectedNodeId] = useState('node-start');
  const [nodes, setNodes] = useState({ 'node-start': scenario.scenarioFlow });

  const getSelectedNode = () => nodes[selectedNodeId];

  const updateNode = (updates) => {
    const updated = { ...getSelectedNode(), ...updates };
    setNodes(prev => ({ ...prev, [selectedNodeId]: updated }));
  };

  const updateChoice = (choiceIdx, updates) => {
    const node = getSelectedNode();
    const updatedChoices = [...node.choices];
    updatedChoices[choiceIdx] = { ...updatedChoices[choiceIdx], ...updates };
    updateNode({ choices: updatedChoices });
  };

  const addChoice = () => {
    const node = getSelectedNode();
    updateNode({
      choices: [
        ...node.choices,
        { text: 'New option', feedback: '', isCorrect: false, nextNodeId: null }
      ]
    });
  };

  const removeChoice = (idx) => {
    const node = getSelectedNode();
    updateNode({ choices: node.choices.filter((_, i) => i !== idx) });
  };

  const addBranch = (choiceIdx) => {
    const newNodeId = `node-${Date.now()}`;
    const newNode = {
      id: newNodeId,
      text: 'New scenario step',
      feedback: 'Feedback for this step',
      type: 'decision',
      choices: [
        { text: 'Continue', feedback: '', isCorrect: true, nextNodeId: 'node-end' }
      ]
    };
    setNodes(prev => ({ ...prev, [newNodeId]: newNode }));
    updateChoice(choiceIdx, { nextNodeId: newNodeId });
  };

  const duplicateNode = () => {
    const newNodeId = `node-${Date.now()}`;
    const newNode = JSON.parse(JSON.stringify(getSelectedNode()));
    newNode.id = newNodeId;
    setNodes(prev => ({ ...prev, [newNodeId]: newNode }));
  };

  const deleteNode = (nodeId) => {
    if (nodeId === 'node-start' || nodeId === 'node-end') return;
    // Rebuild immutably in a single update: drop the node AND clear any choice
    // that pointed at it. The old code shallow-copied then mutated the shared
    // node/choice objects in place (and after setNodes), so the dangling-link
    // cleanup never re-rendered.
    setNodes(prev => {
      const next = {};
      for (const [id, node] of Object.entries(prev)) {
        if (id === nodeId) continue;
        next[id] = {
          ...node,
          choices: (node.choices || []).map(choice =>
            choice.nextNodeId === nodeId ? { ...choice, nextNodeId: null } : choice
          ),
        };
      }
      return next;
    });
    setSelectedNodeId('node-start');
  };

  const handleSave = () => {
    const finalScenario = {
      ...scenario,
      courseId,
      // Persist the FULL node map, not just the start node. Previously only
      // nodes['node-start'] was saved, so every branch authored via addBranch was
      // silently discarded and the player's choices pointed at missing nodes.
      scenarioFlow: { startNodeId: 'node-start', nodes },
      totalNodes: Object.keys(nodes).length,
    };
    onSave(finalScenario);
  };

  const currentNode = getSelectedNode();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Panel: Scenario Properties */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-lg">Scenario Setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="scenario-title" className="text-sm font-medium">Title</label>
            <Input
              id="scenario-title"
              value={scenario.title}
              onChange={(e) => setScenario({ ...scenario, title: e.target.value })}
              placeholder="Scenario title"
            />
          </div>

          <div>
            <label htmlFor="scenario-description" className="text-sm font-medium">Description</label>
            <Textarea
              id="scenario-description"
              value={scenario.description}
              onChange={(e) => setScenario({ ...scenario, description: e.target.value })}
              placeholder="Scenario description"
              className="h-20"
            />
          </div>

          <div>
            <label htmlFor="scenario-patient-context" className="text-sm font-medium">Patient Context</label>
            <Textarea
              id="scenario-patient-context"
              value={scenario.patientContext}
              onChange={(e) => setScenario({ ...scenario, patientContext: e.target.value })}
              placeholder="Patient age, condition, vitals, etc."
              className="h-24"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="scenario-difficulty" className="text-sm font-medium">Difficulty</label>
              <Select value={scenario.difficulty} onValueChange={(val) => setScenario({ ...scenario, difficulty: val })}>
                <SelectTrigger id="scenario-difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="scenario-estimated-minutes" className="text-sm font-medium">Est. Minutes</label>
              <Input
                id="scenario-estimated-minutes"
                type="number"
                value={scenario.estimatedMinutes}
                onChange={(e) => setScenario({ ...scenario, estimatedMinutes: parseInt(e.target.value) })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="scenario-passing-score" className="text-sm font-medium">Passing Score %</label>
            <Input
              id="scenario-passing-score"
              type="number"
              min="0"
              max="100"
              value={scenario.passingScore}
              onChange={(e) => setScenario({ ...scenario, passingScore: parseInt(e.target.value) })}
            />
          </div>

          <Button onClick={handleSave} className="w-full bg-blue-600 hover:bg-blue-700">
            Save Scenario
          </Button>
        </CardContent>
      </Card>

      {/* Middle Panel: Node Selection & Structure */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-lg">Scenario Flow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-96 overflow-y-auto">
          {Object.entries(nodes).map(([nodeId, node]) => (
            <div
              key={nodeId}
              onClick={() => setSelectedNodeId(nodeId)}
              className={`p-3 rounded-lg border-2 cursor-pointer transition ${
                selectedNodeId === nodeId
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <p className="font-medium text-sm">{(node.text || '').substring(0, 40)}...</p>
              <p className="text-xs text-slate-600 mt-1">{node.choices?.length || 0} options</p>
              {nodeId !== 'node-start' && nodeId !== 'node-end' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNode(nodeId);
                  }}
                  className="text-xs text-red-600 hover:text-red-700 mt-2"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Right Panel: Node Editor */}
      {currentNode && (
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Edit: {currentNode.id}</CardTitle>
            {selectedNodeId !== 'node-start' && selectedNodeId !== 'node-end' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={duplicateNode}
                className="gap-2"
              >
                <Copy className="w-4 h-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="node-scenario-text" className="text-sm font-medium">Scenario Text</label>
              <Textarea
                id="node-scenario-text"
                value={currentNode.text}
                onChange={(e) => updateNode({ text: e.target.value })}
                className="h-20"
              />
            </div>

            <div>
              <label htmlFor="node-feedback" className="text-sm font-medium">Feedback (if wrong choice)</label>
              <Textarea
                id="node-feedback"
                value={currentNode.feedback}
                onChange={(e) => updateNode({ feedback: e.target.value })}
                className="h-16"
              />
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Decision Options</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addChoice}
                  className="gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
              </div>

              <div className="space-y-3">
                {currentNode.choices?.map((choice, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={choice.text}
                        onChange={(e) => updateChoice(idx, { text: e.target.value })}
                        placeholder="Choice text"
                        className="flex-1 text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeChoice(idx)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={choice.isCorrect}
                          onChange={(e) => updateChoice(idx, { isCorrect: e.target.checked })}
                        />
                        <span className="font-medium">Correct Choice</span>
                      </label>
                    </div>

                    <Input
                      value={choice.feedback}
                      onChange={(e) => updateChoice(idx, { feedback: e.target.value })}
                      placeholder="Feedback for this choice"
                      className="text-sm"
                    />

                    {choice.nextNodeId ? (
                      <div className="flex items-center justify-between bg-white p-2 rounded border border-green-200">
                        <span className="text-xs text-green-700">→ {choice.nextNodeId}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateChoice(idx, { nextNodeId: null })}
                          className="text-xs"
                        >
                          Clear
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addBranch(idx)}
                        className="w-full gap-1 text-xs"
                      >
                        <ChevronRight className="w-3 h-3" />
                        Add Branch
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}