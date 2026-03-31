'use client';

/**
 * Mini Agent-Project Graph for Dashboard
 * Supports drag-to-connect: draw a cable from an agent to a project to assign it.
 * Uses @xyflow/react connection handling + POST /api/projects/:id/agents
 */

import { useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Connection,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, FolderOpen, X } from 'lucide-react';

interface AgentData {
  id: string;
  agent_name: string;
  display_name: string | null;
}

interface ProjectData {
  id: string;
  slug: string;
}

interface Assignment {
  agent_id: string;
  project_id: string;
  role: 'owner' | 'contributor' | 'readonly';
}

interface Props {
  agents: AgentData[];
  projects: ProjectData[];
  assignments: Assignment[];
}

// Agent node with a right-side handle (source for connections)
function MiniAgentNode({ data }: { data: AgentData }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-violet-spectral/20 border-2 border-violet-spectral flex items-center gap-2 cursor-grab active:cursor-grabbing shadow-lg shadow-violet-spectral/10">
      <Bot className="w-4 h-4 text-violet-spectral" />
      <span className="text-sm font-medium text-white truncate max-w-[120px]">
        {data.display_name || data.agent_name}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-violet-spectral !border-2 !border-violet-glow"
      />
    </div>
  );
}

// Project node with a left-side handle (target for connections)
function MiniProjectNode({ data }: { data: ProjectData }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-charcoal border-2 border-graphite flex items-center gap-2 shadow-lg">
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-violet-ghost !border-2 !border-charcoal"
      />
      <FolderOpen className="w-4 h-4 text-violet-ghost" />
      <span className="text-sm font-medium text-white truncate max-w-[120px]">
        {data.slug}
      </span>
    </div>
  );
}

const nodeTypes = {
  agent: MiniAgentNode,
  project: MiniProjectNode,
};

export function AgentProjectGraphMini({ agents, projects, assignments: initialAssignments }: Props) {
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const initialNodes: Node[] = useMemo(() => {
    const totalHeight = Math.max(agents.length, projects.length) * 70;
    const agentStartY = (totalHeight - agents.length * 70) / 2 + 40;
    const projectStartY = (totalHeight - projects.length * 70) / 2 + 40;

    const agentNodes: Node[] = agents.map((agent, index) => ({
      id: `agent-${agent.id}`,
      type: 'agent',
      position: { x: 60, y: agentStartY + index * 70 },
      data: { ...agent },
      draggable: true,
    }));

    const projectNodes: Node[] = projects.map((project, index) => ({
      id: `project-${project.id}`,
      type: 'project',
      position: { x: 380, y: projectStartY + index * 70 },
      data: { ...project },
      draggable: true,
    }));

    return [...agentNodes, ...projectNodes];
  }, [agents, projects]);

  const initialEdges: Edge[] = useMemo(() => {
    return initialAssignments.map((assignment) => {
      let strokeColor = '#6b7280';
      if (assignment.role === 'owner') strokeColor = '#10b981';
      else if (assignment.role === 'contributor') strokeColor = '#8b5cf6';

      return {
        id: `${assignment.agent_id}-${assignment.project_id}`,
        source: `agent-${assignment.agent_id}`,
        target: `project-${assignment.project_id}`,
        type: 'default',
        animated: assignment.role === 'owner',
        style: {
          stroke: strokeColor,
          strokeWidth: 2,
        },
      };
    });
  }, [initialAssignments]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Handle new connection (drag cable from agent to project)
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      // Extract UUIDs from node IDs
      const agentId = connection.source.replace('agent-', '');
      const projectId = connection.target.replace('project-', '');

      // Don't allow project-to-project or agent-to-agent
      if (!connection.source.startsWith('agent-') || !connection.target.startsWith('project-')) {
        return;
      }

      // Check if edge already exists
      const exists = edges.some(
        (e) => e.source === connection.source && e.target === connection.target,
      );
      if (exists) {
        setStatus({ message: 'Already connected', type: 'error' });
        setTimeout(() => setStatus(null), 2000);
        return;
      }

      // Optimistically add the edge
      const newEdge: Edge = {
        id: `${agentId}-${projectId}`,
        source: connection.source,
        target: connection.target,
        type: 'default',
        animated: true,
        style: { stroke: '#8b5cf6', strokeWidth: 2 },
      };
      setEdges((eds) => [...eds, newEdge]);

      // Call API to persist
      try {
        const res = await fetch(`/api/projects/${projectId}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, role: 'contributor' }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to assign');
        }

        setStatus({ message: 'Agent assigned!', type: 'success' });
      } catch (err) {
        // Rollback edge on failure
        setEdges((eds) => eds.filter((e) => e.id !== newEdge.id));
        setStatus({
          message: err instanceof Error ? err.message : 'Failed to assign',
          type: 'error',
        });
      }

      setTimeout(() => setStatus(null), 3000);
    },
    [edges, setEdges],
  );

  // Handle edge deletion (click edge, then delete)
  const onEdgeDoubleClick = useCallback(
    async (_event: React.MouseEvent, edge: Edge) => {
      const agentId = edge.source.replace('agent-', '');
      const projectId = edge.target.replace('project-', '');

      // Optimistically remove
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));

      try {
        const res = await fetch(`/api/projects/${projectId}/agents`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        });

        if (!res.ok) throw new Error('Failed to unassign');

        setStatus({ message: 'Agent unassigned', type: 'success' });
      } catch {
        // Rollback
        setEdges((eds) => [...eds, edge]);
        setStatus({ message: 'Failed to unassign', type: 'error' });
      }

      setTimeout(() => setStatus(null), 3000);
    },
    [setEdges],
  );

  return (
    <div className="relative w-full h-full">
      {/* Status toast */}
      {status && (
        <div
          className={`absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg ${
            status.type === 'success'
              ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
              : 'bg-red-500/20 border border-red-500/40 text-red-400'
          }`}
        >
          {status.message}
          <button onClick={() => setStatus(null)} className="hover:opacity-70">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Hint */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-gray-600 pointer-events-none">
        Drag from agent handle to project to connect. Double-click edge to remove.
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeDoubleClick={onEdgeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
        zoomOnScroll={false}
        zoomOnPinch={false}
        panOnDrag={true}
        preventScrolling={false}
        connectionLineStyle={{ stroke: '#8b5cf6', strokeWidth: 2 }}
        defaultEdgeOptions={{ type: 'default' }}
        style={{ background: 'transparent' }}
      >
        <Background color="#1a1f35" gap={16} size={0.5} />
      </ReactFlow>
    </div>
  );
}
