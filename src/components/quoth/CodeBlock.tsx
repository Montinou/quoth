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

  const statusBgColors = {
    auditing: "bg-violet-spectral/10",
    passed: "bg-emerald-muted/10",
    failed: "bg-crimson-void/10",
  };

  return (
    <div
      className={cn(
        "relative rounded-xl overflow-hidden border border-violet-spectral/20 bg-charcoal shadow-2xl shadow-violet-glow/10 font-mono text-sm code-window",
        className
      )}
    >
      {/* Scanline effect */}
      <div className="scanline opacity-50" />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-obsidian/80">
        {/* Traffic lights */}
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40 hover:bg-red-500/40 transition-colors" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/40 hover:bg-yellow-500/40 transition-colors" />
          <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/40 hover:bg-green-500/40 transition-colors" />
        </div>

        {/* Filename */}
        {filename && (
          <div className="text-xs text-gray-500 font-medium">
            {filename}
            {language && (
              <span className="ml-2 text-gray-600">({language})</span>
            )}
          </div>
        )}

        {/* Status indicator */}
        {status && (
          <div
            className={cn(
              "text-xs flex items-center gap-1.5 px-2 py-1 rounded-md",
              statusColors[status],
              statusBgColors[status]
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                status === "auditing" && "bg-violet-spectral animate-pulse",
                status === "passed" && "bg-emerald-muted",
                status === "failed" && "bg-crimson-void"
              )}
            />
            <span className="font-medium tracking-wide">
              {statusLabels[status]}
            </span>
          </div>
        )}
      </div>

      {/* Code Body */}
      <div className="p-4 sm:p-6 text-gray-400 leading-relaxed overflow-x-auto text-left">
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
  style?: React.CSSProperties;
}

export function CodeLine({
  children,
  indent = 0,
  highlight = false,
  className,
  style,
}: CodeLineProps) {
  return (
    <div
      className={cn(highlight && "py-1.5 my-1 drift-highlight rounded-sm", className)}
      style={{ paddingLeft: `${indent * 1.25}rem`, ...style }}
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
    string: "text-emerald-400",
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
  title = "Quoth Suggestion",
  children,
  source,
}: CodeSuggestionProps) {
  return (
    <div className="mt-4 p-4 bg-gradient-to-r from-violet-spectral/10 to-violet-spectral/5 border-l-2 border-violet-spectral rounded-r-lg relative overflow-hidden">
      {/* Subtle shimmer effect */}
      <div className="absolute inset-0 animate-shimmer pointer-events-none" />

      <div className="relative z-10">
        <div className="flex items-center gap-2 text-xs text-violet-spectral mb-2 font-sans">
          <span className="w-4 h-4 rounded bg-violet-spectral/20 flex items-center justify-center">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="text-violet-spectral"
            >
              <path
                d="M5 1L6.5 4H9L7 6L8 9L5 7L2 9L3 6L1 4H3.5L5 1Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="font-bold tracking-wide">{title}</span>
        </div>
        <div className="text-white font-mono">{children}</div>
        {source && (
          <div className="text-xs text-gray-500 mt-3 font-sans italic leading-relaxed">
            &ldquo;{source}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}
