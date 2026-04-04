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
2. Iterate through `TASK_PATTERNS` in insertion order (object property order).
3. For each pattern, construct a `RegExp` with the `i` flag and test against the lowercased task.
4. Return the first matching agent with confidence 0.8.
5. If no pattern matches, return `coder` as the default with confidence 0.5.

### Pattern Table

Patterns are tested in this exact order. First match wins.

| Order | Pattern (regex) | Routes To | Example Matches |
|-------|----------------|-----------|-----------------|
| 1 | `implement\|create\|build\|add\|write code` | `coder` | "implement user auth", "create a new endpoint", "add validation" |
| 2 | `test\|spec\|coverage\|unit test\|integration` | `tester` | "write tests for the API", "check coverage", "integration test" |
| 3 | `review\|audit\|check\|validate\|security` | `reviewer` | "review this PR", "security audit", "validate the schema" |
| 4 | `research\|find\|search\|documentation\|explore` | `researcher` | "research best practices", "find examples of", "explore options" |
| 5 | `design\|architect\|structure\|plan` | `architect` | "design the database schema", "plan the migration" |
| 6 | `api\|endpoint\|server\|backend\|database` | `backend-dev` | "fix the API endpoint", "database migration", "server config" |
| 7 | `ui\|frontend\|component\|react\|css\|style` | `frontend-dev` | "update the UI", "fix CSS", "create a React component" |
| 8 | `deploy\|docker\|ci\|cd\|pipeline\|infrastructure` | `devops` | "deploy to production", "fix the CI pipeline", "Docker config" |

### Pattern Priority and Conflicts

Because first-match wins, pattern order matters for ambiguous tasks:

- "create a React component" matches `coder` (pattern 1: "create") before it could match `frontend-dev` (pattern 7: "react", "component").
- "test the deployment pipeline" matches `tester` (pattern 2: "test") before `devops` (pattern 8: "pipeline").
- "review the API endpoint" matches `reviewer` (pattern 3: "review") before `backend-dev` (pattern 6: "api", "endpoint").
- "add a test for the frontend" matches `coder` (pattern 1: "add") before `tester` or `frontend-dev`.

The general hierarchy is: action verbs (implement/create/test/review) take precedence over domain nouns (api/frontend/docker).

### Default Routing

When no pattern matches, the function returns:
```javascript
{ agent: 'coder', confidence: 0.5, reason: 'Default routing - no specific pattern matched' }
```

Tasks that typically fall through to default routing include:
- Vague descriptions: "fix this", "make it work", "update the thing"
- Non-English descriptions
- Domain-specific jargon not covered by the keyword patterns
- Tasks phrased as questions: "why is this failing?"

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
    |         |                        (first-match, 8 patterns)
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

As documented in the project roadmap:

1. **Keyword-only matching**: The routing uses simple regex patterns with no semantic understanding. Tasks like "optimize the rendering pipeline" might not match any pattern despite being clearly a `frontend-dev` task.

2. **High default routing fallback rate**: Many real-world task descriptions do not contain the exact keywords in the pattern table, leading to frequent fallback to `coder` with 0.5 confidence.

3. **No learned routing patterns**: The system does not learn from past routing decisions. A task that was successfully completed by a `backend-dev` after being routed to `coder` does not improve future routing for similar tasks.

4. **No project-specific routing**: All projects use the same 8 keyword patterns. A project that is predominantly frontend work still routes through the same generic patterns.

5. **Static confidence values**: Routing confidence is always either 0.8 (pattern match) or 0.5 (default). There is no mechanism to learn that certain patterns are more reliable predictors than others.

6. **Alternative selection is uninformed**: Alternatives are always the next two agents in insertion order, regardless of task content. A database task routed to `backend-dev` should suggest `devops` and `architect` as alternatives, not `coder` and `tester`.

7. **Pattern overlap**: Some patterns like "check" (reviewer) can match tasks that have nothing to do with code review (e.g., "check if the build passed" should route to devops).

8. **Hardcoded metrics**: The success probability, duration, and complexity in the hook output are static values that provide no real information.

## Exported API

`routing.js` exports:

| Export | Type | Description |
|--------|------|-------------|
| `routeTask(task)` | Function | Returns `{ agent, confidence, reason }` |
| `getAlternatives(primaryAgent)` | Function | Returns array of 2 alternatives |
| `AGENT_CAPABILITIES` | Object | Map of agent name to capability tags |
| `TASK_PATTERNS` | Object | Map of regex pattern string to agent name |
