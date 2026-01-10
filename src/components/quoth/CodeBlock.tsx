"use client";

import { cn } from "@/lib/utils";

interface CodeBlockProps {
  filename?: string;
  language?: string;
  children: React.ReactNode;
  className?: string;
  status?: "auditing" | "passed" | "failed";
}

export function CodeBlock({
  filename,
  language,
  children,
  className,
  status,
}: CodeBlockProps) {
  const statusColors = {
    auditing: "text-violet-spectral",
    passed: "text-emerald-muted",
    failed: "text-crimson-void",
  };

  const statusLabels = {
    auditing: "AUDITING",
    passed: "PASSED",
    failed: "FAILED",
  };

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden border border-violet-spectral/20 bg-charcoal shadow-2xl shadow-violet-glow/10 font-mono text-sm",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-obsidian">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
          <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
        </div>

        {filename && (
          <div className="text-xs text-gray-500">
            {filename}
            {language && <span className="ml-2 text-gray-600">({language})</span>}
          </div>
        )}

        {status && (
          <div
            className={cn(
              "text-xs flex items-center gap-1",
              statusColors[status]
            )}
          >
            <span className={status === "auditing" ? "animate-pulse" : ""}>●</span>
            {statusLabels[status]}
          </div>
        )}
      </div>

      {/* Code Body */}
      <div className="p-6 text-gray-400 leading-relaxed overflow-x-auto text-left">
        {children}
      </div>
    </div>
  );
}

interface CodeLineProps {
  children: React.ReactNode;
  indent?: number;
  highlight?: boolean;
  className?: string;
}

export function CodeLine({
  children,
  indent = 0,
  highlight = false,
  className,
}: CodeLineProps) {
  return (
    <div
      className={cn(
        highlight && "py-1 my-1 drift-highlight",
        className
      )}
      style={{ paddingLeft: `${indent * 1}rem` }}
    >
      {children}
    </div>
  );
}

interface CodeKeywordProps {
  children: React.ReactNode;
  type?: "keyword" | "string" | "comment" | "function";
}

export function CodeKeyword({ children, type = "keyword" }: CodeKeywordProps) {
  const colors = {
    keyword: "text-pink-400",
    string: "text-green-400",
    comment: "text-gray-500",
    function: "text-blue-400",
  };

  return <span className={colors[type]}>{children}</span>;
}

interface CodeSuggestionProps {
  title?: string;
  children: React.ReactNode;
  source?: string;
}

export function CodeSuggestion({
  title = "QUOTH SUGGESTION",
  children,
  source,
}: CodeSuggestionProps) {
  return (
    <div className="mt-4 p-3 bg-violet-spectral/5 border-l-2 border-violet-spectral rounded-r">
      <div className="text-xs text-violet-spectral mb-1 font-sans font-bold">
        {title}
      </div>
      <div className="text-white">{children}</div>
      {source && (
        <div className="text-xs text-gray-500 mt-2 font-sans italic">
          "{source}"
        </div>
      )}
    </div>
  );
}
