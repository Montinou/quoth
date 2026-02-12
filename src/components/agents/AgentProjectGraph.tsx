'use client';

/**
 * Agent-Project Graph Component
 * Interactive node-based visualization using React Flow
 */

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, FolderOpen, Circle } from 'lucide-react';
import Link from 'next/link';

interface Agent {
  id: string;
  agent_name: string;
  display_name: string | null;
  instance: string;
  status: string;
  [key: string]: unknown;
}

interface Project {
  id: string;
  slug: string;
  is_public: boolean;
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
  organizationId: string;
}

// Custom Agent Node
function AgentNode({ data }: { data: Agent & { isOnline: boolean } }) {
  return (
    <Link href={`/agents/${data.agent_name}`}>
      <div className="px-6 py-4 rounded-2xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border-2 border-violet-spectral shadow-lg shadow-violet-spectral/20 hover:shadow-xl hover:shadow-violet-spectral/30 transition-all cursor-pointer min-w-[200px]">
        <div className="flex items-center gap-3 mb-2">
          <Bot className="w-5 h-5 text-violet-spectral" />
          <span className="font-semibold text-white">
            {data.display_name || data.agent_name}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Circle
            className={`w-2 h-2 ${
              data.status === 'active' && data.isOnline
                ? 'fill-green-400 text-green-400'
                : 'fill-gray-400 text-gray-400'
            }`}
          />
          <span className="text-gray-400">@{data.agent_name}</span>
        </div>
        <div className="text-xs text-gray-500 mt-1">{data.instance}</div>
      </div>
    </Link>
  );
}

// Custom Project Node
function ProjectNode({ data }: { data: Project }) {
  return (
    <Link href={`/dashboard/${data.slug}`}>
      <div className="px-6 py-4 rounded-2xl bg-gradient-to-br from-charcoal to-graphite border-2 border-graphite shadow-lg hover:border-violet-spectral/50 transition-all cursor-pointer min-w-[200px]">
        <div className="flex items-center gap-3 mb-2">
          <FolderOpen className="w-5 h-5 text-violet-ghost" />
          <span className="font-semibold text-white">{data.slug}</span>
        </div>
        {data.is_public && (
          <div className="text-xs px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-400 inline-block">
            Public
          </div>
        )}
      </div>
    </Link>
  );
}

const nodeTypes = {
  agent: AgentNode,
  project: ProjectNode,
};

export function AgentProjectGraph({ agents, projects, assignments, organizationId }: Props) {
  // Convert data to React Flow format
  const initialNodes: Node[] = useMemo(() => {
    const agentNodes = agents.map((agent, index) => ({
      id: `agent-${agent.id}`,
      type: 'agent',
      position: { x: 100, y: index * 150 + 100 },
      data: { ...agent, isOnline: false },
    }));

    const projectNodes = projects.map((project, index) => ({
      id: `project-${project.id}`,
      type: 'project',
      position: { x: 600, y: index * 150 + 100 },
      data: { ...project },
    }));

    return [...agentNodes, ...projectNodes] as Node[];
  }, [agents, projects]);

  const initialEdges: Edge[] = useMemo(() => {
    return assignments.map((assignment) => {
      // Edge styling based on role
      let strokeColor = '#6b7280'; // gray
      let strokeWidth = 2;
      
      if (assignment.role === 'owner') {
        strokeColor = '#10b981'; // green
        strokeWidth = 3;
      } else if (assignment.role === 'contributor') {
        strokeColor = '#8b5cf6'; // violet
        strokeWidth = 2;
      }

      return {
        id: `${assignment.agent_id}-${assignment.project_id}`,
        source: `agent-${assignment.agent_id}`,
        target: `project-${assignment.project_id}`,
        type: 'default',
        animated: assignment.role === 'owner',
        style: {
          stroke: strokeColor,
          strokeWidth,
        },
        label: assignment.role,
        labelStyle: {
          fill: strokeColor,
          fontWeight: 600,
          fontSize: 12,
        },
        labelBgStyle: {
          fill: '#0a0e1a',
          fillOpacity: 0.9,
        },
      };
    });
  }, [assignments]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: any) => {
      // TODO: Call API to create assignment
      console.log('Connect:', connection);
    },
    []
  );

  return (
    <div className="flex-1 relative bg-obsidian">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 py-4 bg-gradient-to-b from-obsidian to-transparent">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Agent-Project Graph</h1>
            <p className="text-sm text-gray-400">
              Visual overview • {agents.length} agents • {projects.length} projects •{' '}
              {assignments.length} assignments
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/agents"
              className="px-4 py-2 rounded-lg bg-charcoal hover:bg-violet-spectral/20 text-white transition-colors text-sm font-medium"
            >
              List View
            </Link>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 glass-panel rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-3">
          Connection Types
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-green-400" />
            <span className="text-xs text-white">Owner (animated)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-violet-spectral" />
            <span className="text-xs text-white">Contributor</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-gray-400" />
            <span className="text-xs text-white">Readonly</span>
          </div>
        </div>
      </div>

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.5}
        maxZoom={1.5}
        defaultEdgeOptions={{
          type: 'default',
        }}
        style={{
          background: '#0a0e1a',
        }}
      >
        <Background
          color="#1a1f35"
          gap={16}
          size={1}
        />
        <Controls
          className="!bg-charcoal !border-violet-spectral/20"
          style={{
            button: {
              backgroundColor: '#131a2b',
              borderColor: '#1f2937',
              color: '#fff',
            },
          }}
        />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'agent') return '#8b5cf6';
            return '#374151';
          }}
          className="!bg-charcoal !border-violet-spectral/20"
        />
      </ReactFlow>
    </div>
  );
}
