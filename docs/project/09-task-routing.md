# Task Routing

Quoth's task routing system classifies incoming tasks by keyword matching and recommends the optimal agent type for execution. It is a lightweight, zero-latency classifier that runs entirely in-process with no API calls or model inference.

Source files:
- `quoth-plugin/mcp/lib/routing.js` -- agent definitions, pattern matching, alternative selection
- `quoth-plugin/mcp/handlers/intelligence.js` -- enrichment with intelligence context (MCP tool path)
- `quoth-plugin/hooks/hook-dispatch.js` -- hook integration (route command)

## Agent Types

Eight agent types are defined, each with a set of capability tags:

| Agent | Capabilities |
|-------|-------------|
| `coder` | code-generation, refactoring, debugging, implementation |
| `tester` | unit-testing, integration-testing, coverage, test-generation |
| `reviewer` | code-review, security-audit, quality-check, best-practices |
| `researcher` | web-search, documentation, analysis, summarization |
| `architect` | system-design, architecture, patterns, scalability |
| `backend-dev` | api, database, server, authentication |
| `frontend-dev` | ui, react, css, components |
| `devops` | ci-cd, docker, deployment, infrastructure |

These are defined in `AGENT_CAPABILITIES` and exported for external use (e.g., by `quoth_assign_task` for capability matching).

## Routing Algorithm

Implemented in `routing.js: routeTask(task)`.

### Process

1. Convert the task description to lowercase.
2. Iterate through `TASK_PATTERNS` array in order (array of `[RegExp, agentType]` tuples).
3. For each entry, test the pre-compiled regex against the lowercased task.
4. Return the first matching agent with confidence 0.8.
5. If no pattern matches, return `coder` as the default with confidence 0.5.

### Pattern Table

`TASK_PATTERNS` is an ordered array of `[RegExp, agentType]` tuples (~20 entries). Patterns are tested in priority order — first match wins. Specific intent patterns (fix, debug, refactor) are tested before broad domain patterns (api, frontend, deploy).

**English patterns (with `\b` word boundaries):**

| Priority | Pattern (keywords) | Routes To | Example Matches |
|----------|--------------------|-----------|-----------------|
| 1 | fix, bug, debug, broken, crash, hotfix, patch | `coder` | "fix the broken auth", "debug the crash" |
| 2 | refactor, rename, extract, reorganize, cleanup, simplify | `coder` | "refactor the database layer", "cleanup imports" |
| 3 | test, spec, coverage, unit test, assert, mock, jest, vitest | `tester` | "write tests for the API", "check coverage" |
| 4 | review, audit, security check, lint, inspect, validate | `reviewer` | "review this PR", "security audit" |
| 5 | research, explore, investigate, look up, summarize, documentation | `researcher` | "research best practices", "investigate the issue" |
| 6 | design, architect, blueprint, diagram, schema, model | `architect` | "design the database schema" |
| 7 | configure, setup, install, environment, settings | `devops` | "configure env vars", "setup the project" |
| 8 | deploy, docker, ci/cd, pipeline, infrastructure, vercel, nginx, systemd, cron | `devops` | "deploy to production", "fix the CI pipeline" |
| 9 | implement, create, build, add, develop, scaffold, generate, write code | `coder` | "implement user auth", "create a new endpoint" |
| 10 | api, endpoint, backend, database, migration, postgres, sqlite, prisma, drizzle | `backend-dev` | "database migration", "new API endpoint" |
| 11 | ui, frontend, component, react, css, style, layout, responsive, tailwind, shadcn | `frontend-dev` | "update the UI", "fix CSS" |

**Spanish patterns (Argentine voseo, no `\b` boundaries due to accented chars):**

| Priority | Pattern (keywords) | Routes To |
|----------|--------------------|-----------|
| 1 | arreglá, corregí, roto, crashea | `coder` |
| 2 | refactoreá, renombrá, reorganizá, simplificá, limpiá | `coder` |
| 3 | testea, probá, pruebas, test unitario | `tester` |
| 4 | revisá, auditá, chequeá, validá, seguridad | `reviewer` |
| 5 | investigá, buscá, explorá, documentación, analizá, resumí | `researcher` |
| 6 | diseñá, arquitectura, planificá, diagrama, esquema | `architect` |
| 7 | configurá, instalá, entorno, configuración | `devops` |
| 8 | desplegá, infraestructura, servidor | `devops` |
| 9 | implementa, creá, construí, agregá, desarrollá, generá | `coder` |

### Pattern Priority and Conflicts

Because first-match wins, pattern order is deliberately structured:

1. **Specific intent first:** Fix/debug/refactor patterns match before broad domain patterns. "Fix the API endpoint" routes to `coder` (fix intent) not `backend-dev` (api domain).
2. **Action verbs before domain nouns:** "implement the frontend" routes to `coder` (implement intent) before `frontend-dev` (frontend domain).
3. **Spanish patterns interleaved:** Each Spanish pattern group follows its English equivalent in priority.

Word boundary behavior:
- **English patterns** use `\b` to prevent substring false positives (e.g., "checking" won't match "check" in reviewer pattern).
- **Spanish patterns** omit `\b` because JavaScript's `\b` treats accented characters (`á`, `é`, `í`, etc.) as non-word characters, breaking word boundary detection on Spanish words.

### Default Routing

When no pattern matches, the function returns:
```javascript
{ agent: 'coder', confidence: 0.5, reason: 'Default routing - no specific pattern matched' }
```

Tasks that typically fall through to default routing include:
- Vague descriptions without action verbs: "what time is it", "how does this work"
- Domain-specific jargon not covered by the keyword patterns
- Tasks phrased as questions without matching keywords: "why is this failing?" (Note: "fix" or "debug" keywords would catch most troubleshooting requests)

## Alternative Agents

Implemented in `routing.js: getAlternatives(primaryAgent)`.

### Algorithm

1. Get all agent types from `AGENT_CAPABILITIES`.
2. Filter out the primary agent.
3. Take the first 2 remaining agents (in object insertion order).
4. Assign decreasing confidence: first alternative gets 0.6, second gets 0.5.

### Output

```javascript
[
  { agent: 'tester', confidence: 0.6, reason: 'Alternative agent for tester capabilities' },
  { agent: 'reviewer', confidence: 0.5, reason: 'Alternative agent for reviewer capabilities' }
]
```

### Selection Note

The alternative selection is deterministic but not intelligent -- it simply takes the next two agents in the capability map's insertion order after filtering out the primary. For example, if the primary is `coder`, alternatives are always `tester` (0.6) and `reviewer` (0.5). If the primary is `tester`, alternatives are always `coder` (0.6) and `reviewer` (0.5).

The alternatives do not consider the task content at all. They serve as fallback suggestions, not informed secondary recommendations.

## Hook Integration

The `route` command in `hook-dispatch.js` is triggered by the `UserPromptSubmit` hook, running on every user message.

### Execution Flow

1. **Get intelligence context**: Call `intel.getContext(prompt, 5)` to find relevant entries in the intelligence graph using trigram matching + PageRank scoring.

2. **Display relevant patterns**: Filter entries with `score >= 0.1`, take top 3, and output:
   ```
   [INTELLIGENCE] Relevant patterns for this task:
     * (0.42) Pattern summary [rank #1, 5x accessed]
     * (0.31) Pattern summary [rank #2, 2x accessed]
   ```

3. **Route the task**: Call `routeTask(prompt)` for the primary recommendation.

4. **Get alternatives**: Call `getAlternatives(result.agent)` for two fallback options.

5. **Format output**: Produce a structured table for Claude Code:
   ```
   [INFO] Routing task: <first 80 chars of prompt>

   Routing Method
     - Method: keyword
     - Backend: quoth-intelligence
     - Latency: <random 0.1-0.6ms>
     - Matched Pattern: <reason from routeTask>

   +------------------- Primary Recommendation -------------------+
   | Agent: coder                                                  |
   | Confidence: 80.0%                                             |
   | Reason: Matched pattern: implement|create|build|add|write code|
   +--------------------------------------------------------------+

   Alternative Agents
   +------------+------------+-------------------------------------+
   | Agent Type | Confidence | Reason                              |
   +------------+------------+-------------------------------------+
   | tester     |      60.0% | Alternative agent for tester cap... |
   | reviewer   |      50.0% | Alternative agent for reviewer c... |
   +------------+------------+-------------------------------------+

   Estimated Metrics
     - Success Probability: 70.0%
     - Estimated Duration: 10-30 min
     - Complexity: LOW
   ```

Note: The "Estimated Metrics" section (success probability, duration, complexity) is hardcoded and not derived from any actual analysis. The latency value is randomized between 0.1ms and 0.6ms for display purposes.

## MCP Tool Enrichment

When routing is invoked via the `quoth_route_task` MCP tool (as opposed to the hook), the result is enriched with intelligence context:

```javascript
case 'quoth_route_task': {
  const result = routeTask(args.task)
  const alternatives = getAlternatives(result.agent)
  const context = getContext(args.task, 3)
  return { ...result, alternatives, relevantPatterns: context.entries || [] }
}
```

The MCP tool response includes:
- `agent` -- primary agent recommendation
- `confidence` -- routing confidence (0.8 or 0.5)
- `reason` -- matched pattern string or "Default routing"
- `alternatives` -- array of 2 alternative agents
- `relevantPatterns` -- top 3 intelligence graph entries relevant to the task (with id, summary, score, confidence, pageRank, accessCount)

This enrichment allows callers to see not just the routing decision but also what knowledge the system has about similar past tasks.

## Architecture Diagram

```
User Prompt
    |
    v
[UserPromptSubmit Hook]
    |
    +---> getContext(prompt, 5) ---> Intelligence Graph
    |         |                        (trigram + PageRank)
    |         v
    |     Display relevant patterns (score >= 0.1)
    |
    +---> routeTask(prompt) -------> Keyword Pattern Matching
    |         |                        (first-match, ~20 patterns EN+ES)
    |         v
    |     Primary agent + confidence
    |
    +---> getAlternatives(agent) --> Deterministic selection
    |         |                        (next 2 in order)
    |         v
    |     Format and output table
    |
    v
[Routed to agent with context]
```

## Current Limitations

1. **Keyword-only matching**: The routing uses regex patterns with no semantic understanding. Tasks like "optimize the rendering pipeline" might not match any pattern despite being clearly a `frontend-dev` task.

2. **No learned routing patterns**: The system does not learn from past routing decisions. A task that was successfully completed by a `backend-dev` after being routed to `coder` does not improve future routing for similar tasks.

3. **No project-specific routing**: All projects use the same keyword patterns. A project that is predominantly frontend work still routes through the same generic patterns.

4. **Static confidence values**: Routing confidence is always either 0.8 (pattern match) or 0.5 (default). There is no mechanism to learn that certain patterns are more reliable predictors than others.

5. **Alternative selection is uninformed**: Alternatives are always the next two agents in insertion order, regardless of task content.

6. **Hardcoded metrics**: The success probability, duration, and complexity in the hook output are static values that provide no real information.

### Improvements in v3.2.1

The following limitations from v3.2.0 have been addressed:

- ~~High default routing fallback rate~~ — Expanded from 8 to ~20 pattern groups including fix/debug/refactor/config categories. Spanish language support added with Argentine voseo forms.
- ~~Pattern overlap ("check" false positives)~~ — Word boundaries (`\b`) added to English patterns to prevent substring matches. "checking" no longer triggers "check" in the reviewer pattern.

## Exported API

`routing.js` exports:

| Export | Type | Description |
|--------|------|-------------|
| `routeTask(task)` | Function | Returns `{ agent, confidence, reason }` |
| `getAlternatives(primaryAgent)` | Function | Returns array of 2 alternatives |
| `AGENT_CAPABILITIES` | Object | Map of agent name to capability tags |
| `TASK_PATTERNS` | Array | Array of `[RegExp, agentType]` tuples, tested in order |
