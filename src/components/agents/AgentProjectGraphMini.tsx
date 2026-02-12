'use client';

/**
 * Mini Agent-Project Graph for Dashboard
 * Compact embedded version with no controls
 */

import { useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, FolderOpen } from 'lucide-react';

interface Agent {
  id: string;
  agent_name: string;
  display_name: string | null;
  [key: string]: unknown;
}

interface Project {
  id: string;
  slug: string;
  [key: string]: unknown;
}

interface Assignment {
  agent_id: string;
  project_id: string;
  role: 'owner' | 'contributor' | 'readonly';
}

interface Props {
  agents: Agent[];
  projects: Project[];
  assignments: Assignment[];
}

// Simplified node components for mini view
function MiniAgentNode({ data }: { data: Agent }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-violet-spectral/20 border border-violet-spectral flex items-center gap-2">
      <Bot className="w-3 h-3 text-violet-spectral" />
      <span className="text-xs text-white truncate max-w-[100px]">
        {data.agent_name}
      </span>
    </div>
  );
}

function MiniProjectNode({ data }: { data: Project }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-charcoal border border-graphite flex items-center gap-2">
      <FolderOpen className="w-3 h-3 text-violet-ghost" />
      <span className="text-xs text-white truncate max-w-[100px]">
        {data.slug}
      </span>
    </div>
  );
}

const nodeTypes = {
  agent: MiniAgentNode,
  project: MiniProjectNode,
};

export function AgentProjectGraphMini({ agents, projects, assignments }: Props) {
  const nodes: Node[] = useMemo(() => {
    const agentNodes: Node[] = agents.map((agent, index) => ({
      id: `agent-${agent.id}`,
      type: 'agent',
      position: { x: 50, y: index * 60 + 50 },
      data: { ...agent } as Record<string, unknown>,
      draggable: false,
    }));

    const projectNodes: Node[] = projects.map((project, index) => ({
      id: `project-${project.id}`,
      type: 'project',
      position: { x: 300, y: index * 60 + 50 },
      data: { ...project } as Record<string, unknown>,
      draggable: false,
    }));

    return [...agentNodes, ...projectNodes];
  }, [agents, projects]);

  const edges: Edge[] = useMemo(() => {
    return assignments.map((assignment) => {
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
          strokeWidth: 1.5,
        },
      };
    });
  }, [assignments]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      panOnDrag={false}
      preventScrolling={false}
      style={{
        background: 'transparent',
      }}
    >
      <Background
        color="#1a1f35"
        gap={12}
        size={0.5}
      />
    </ReactFlow>
  );
}
