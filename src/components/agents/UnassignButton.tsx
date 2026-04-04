"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

interface UnassignButtonProps {
  agentId: string;
  projectId: string;
}

export function UnassignButton({ agentId, projectId }: UnassignButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleUnassign = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm("Remove this agent from the project?")) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to unassign agent");
        return;
      }

      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleUnassign}
      disabled={loading}
      title="Unassign from project"
      className="p-1.5 rounded-lg border border-transparent hover:border-red-500/30 hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-all disabled:opacity-50"
    >
      <X className="w-4 h-4" />
    </button>
  );
}
