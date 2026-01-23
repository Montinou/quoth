/**
 * CodeDemo Component v2.0
 * Enhanced visual effects, refined animations, better readability
 */

"use client";

import { useState, useEffect } from "react";
import {
  CodeBlock,
  CodeLine,
  CodeKeyword,
  CodeSuggestion,
} from "./CodeBlock";

export function CodeDemo() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Small delay to ensure animation triggers after mount
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative">
      {/* Ambient glow behind the code block */}
      <div className="absolute inset-0 bg-violet-spectral/5 rounded-2xl blur-2xl scale-105 -z-10" />

      <CodeBlock
        filename="UserService.test.ts"
        status="auditing"
        className="max-w-2xl mx-auto"
      >
        {/* Analysis header */}
        <div className="mb-4 flex items-center gap-2 text-gray-500 text-xs sm:text-sm">
          <span className="text-violet-spectral font-semibold">// Quoth Analysis:</span>
          <span className="px-2 py-0.5 bg-amber-warning/10 text-amber-warning rounded text-xs">
            1 Violation Detected
          </span>
        </div>

        {/* Import statements */}
        <div
          className={`transition-all duration-500 ${
            isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
          }`}
          style={{ transitionDelay: "0ms" }}
        >
          <CodeKeyword>import</CodeKeyword>
          <span className="text-gray-400"> {"{"} describe, it, expect {"}"} </span>
          <CodeKeyword>from</CodeKeyword>{" "}
          <CodeKeyword type="string">&apos;vitest&apos;</CodeKeyword>
          <span className="text-gray-600">;</span>
        </div>

        <div
          className={`transition-all duration-500 ${
            isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
          }`}
          style={{ transitionDelay: "50ms" }}
        >
          <CodeKeyword>import</CodeKeyword>
          <span className="text-gray-400"> {"{"} UserService {"}"} </span>
          <CodeKeyword>from</CodeKeyword>{" "}
          <CodeKeyword type="string">&apos;./UserService&apos;</CodeKeyword>
          <span className="text-gray-600">;</span>
        </div>

        <br />

        {/* Describe block */}
        <div
          className={`opacity-40 transition-all duration-500 ${
            isVisible ? "opacity-40 translate-x-0" : "opacity-0 -translate-x-4"
          }`}
          style={{ transitionDelay: "100ms" }}
        >
          <span className="text-blue-400">describe</span>
          <span className="text-gray-400">(</span>
          <CodeKeyword type="string">&apos;UserService&apos;</CodeKeyword>
          <span className="text-gray-400">, () ={">"} {"{"}</span>
        </div>

        <CodeLine
          indent={1}
          className={`opacity-40 transition-all duration-500 ${
            isVisible ? "opacity-40 translate-x-0" : "opacity-0 -translate-x-4"
          }`}
          style={{ transitionDelay: "150ms" }}
        >
          <span className="text-blue-400">it</span>
          <span className="text-gray-400">(</span>
          <CodeKeyword type="string">&apos;should fetch user&apos;</CodeKeyword>
          <span className="text-gray-400">, </span>
          <CodeKeyword>async</CodeKeyword>
          <span className="text-gray-400"> () ={">"} {"{"}</span>
        </CodeLine>

        {/* Violation line - highlighted */}
        <CodeLine
          indent={2}
          highlight
          className={`transition-all duration-700 ${
            isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
          }`}
          style={{ transitionDelay: "250ms" }}
        >
          <CodeKeyword>const</CodeKeyword>
          <span className="text-gray-300"> mock = </span>
          <span className="text-red-400">jest</span>
          <span className="text-gray-300">.fn();</span>
          <span className="ml-3 sm:ml-4 inline-flex items-center gap-1.5 text-[10px] sm:text-xs uppercase tracking-widest text-violet-ghost font-sans border border-violet-spectral/50 px-2 py-0.5 rounded bg-violet-spectral/20 animate-pulse-glow">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-warning" />
            Violation
          </span>
        </CodeLine>

        <CodeLine
          indent={2}
          className={`opacity-40 transition-all duration-500 ${
            isVisible ? "opacity-40 translate-x-0" : "opacity-0 -translate-x-4"
          }`}
          style={{ transitionDelay: "300ms" }}
        >
          <span className="text-gray-500">...</span>
        </CodeLine>

        {/* Quoth Suggestion */}
        <div
          className={`transition-all duration-700 ${
            isVisible
              ? "opacity-100 translate-y-0 scale-100"
              : "opacity-0 translate-y-4 scale-95"
          }`}
          style={{ transitionDelay: "400ms" }}
        >
          <CodeSuggestion source="According to 'patterns/backend-unit-vitest.md', Jest globals are forbidden. Use Vitest native utilities.">
            <CodeKeyword>const</CodeKeyword>
            <span className="text-gray-300"> mock = </span>
            <span className="text-emerald-muted">vi</span>
            <span className="text-gray-300">.fn();</span>
          </CodeSuggestion>
        </div>
      </CodeBlock>
    </div>
  );
}
