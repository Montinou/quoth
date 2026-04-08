# Task Routing

Quoth's task routing system classifies incoming tasks by keyword matching and recommends the optimal agent type for execution. It is a lightweight, zero-latency classifier that runs entirely in-process with no API calls or model inference.

<!-- v1.0.2 — Last updated: 2026-04-08 -->

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

These are defined in `AGENT_CAPABILITIES`. The derived constant `AGENT_TYPES = Object.keys(AGENT_CAPABILITIES)` is the canonical single source of truth for agent role types across the system:

- **Task routing** (`routeTask`) -- determines which agent types can be recommended
- **Batch JUDGE domain classification** -- the daemon's JUDGE stage classifies trajectories into these types
- **Pattern `agent:<type>` tags** -- distilled patterns are tagged with `agent:coder`, `agent:tester`, etc.
- **Injection tag filtering** -- session-start and subagent-start hooks filter patterns by these tags

Note: these are *domain role* types (coder, tester, reviewer, etc.), not *platform/runtime* types. MCP `agent_register` uses a separate taxonomy (`claude-code`, `openclaw`, `daemon`, `worker`) that classifies the agent's runtime, not its domain role.

## Routing Algorithm

Implemented in `routing.js: routeTask(task)`.

### Process

1. Convert the task description to lowercase, then strip accents via `stripAccents()` (NFD + remove combining marks).
2. Iterate through `TASK_PATTERNS` array in order (array of `[RegExp, agentType, confidence?]` tuples).
3. For each entry, test the pre-compiled regex against the normalized task.
4. Return the first matching agent with confidence from the tuple (defaults to 0.8 if not specified).
5. If no pattern matches, return `coder` as the default with confidence 0.5.

### Pattern Table

`TASK_PATTERNS` is an ordered array of `[RegExp, agentType, confidence?]` tuples (~28 entries, 14 English + 14 Spanish). Patterns are tested in priority order — first match wins. Specific intent patterns (fix, debug, refactor) are tested before broad domain patterns (api, frontend, deploy). Conversational/question patterns are last with an explicit confidence of 0.6.

**English patterns (with `\b` word boundaries):**

| Priority | Pattern (keywords) | Routes To | Example Matches |
|----------|--------------------|-----------|-----------------|
| 1 | fix, bug, debug, broken, crash, hotfix, patch, error, not working, fails, issue, troubleshoot, stacktrace, exception, segfault, undefined, null pointer | `coder` | "fix the broken auth", "debug the crash", "undefined is not a function" |
| 2 | refactor, rename, extract, reorganize, cleanup, clean up, simplify, deduplicate, dedup, dry, modularize, split file, move to, optimize code | `coder` | "refactor the database layer", "cleanup imports" |
| 3 | test, spec, coverage, unit test, integration test, assert, mock, fixture, jest, vitest, e2e, playwright, cypress, snapshot | `tester` | "write tests for the API", "check coverage" |
| 4 | review, audit, security check, lint, inspect, validate, code quality, sonar, eslint | `reviewer` | "review this PR", "security audit" |
| 5 | commit, push, pull, merge, rebase, cherry-pick, stash, tag, release, branch, checkout, diff, log, blame, bisect, amend, squash, reset, revert | `coder` | "commit these changes", "rebase onto main" |
| 6 | readme, changelog, write doc, update doc, jsdoc, typedoc, comment, annotate, documentation | `researcher` | "update the readme", "add jsdoc comments" |
| 7 | research, explore, investigate, look up, summarize, find out, compare, benchmark, evaluate, analyze, assess | `researcher` | "research best practices", "investigate the issue" |
| 8 | design, architect, blueprint, diagram, schema, model, system design, data model, erd, uml, sequence diagram | `architect` | "design the database schema" |
| 9 | config, configure, setup, install, env, environment, settings, .env, yaml, toml, ini, dotfile, eslintrc, tsconfig, package.json | `devops` | "configure env vars", "setup the project" |
| 10 | deploy, docker, ci/cd, pipeline, infrastructure, vercel, nginx, systemd, cron, kubernetes, k8s, terraform, ansible, aws, gcp, azure, cloudflare, ssl, cert, dns, domain | `devops` | "deploy to production", "fix the CI pipeline" |
| 11 | implement, create, build, add, develop, scaffold, generate, write code, code, make, new file, new function, new class, new module | `coder` | "implement user auth", "create a new endpoint" |
| 12 | api, endpoint, backend, database, migration, postgres, sqlite, prisma, drizzle, query, sql, seed, orm, graphql, rest, webhook, middleware, auth, jwt, oauth, session | `backend-dev` | "database migration", "new API endpoint" |
| 13 | ui, frontend, component, react, css, style, layout, responsive, tailwind, shadcn, animation, modal, form, button, page, view, route, navigation, theme, dark mode | `frontend-dev` | "update the UI", "fix CSS" |
| 14 | what, how, why, when, where, who, which, can you, could you, tell me, show me, explain, describe, check, verify, status, is there, are there, do we, does it, list, help (prompt-start only) | `researcher` (0.6) | "what does this do?", "how does auth work?" |

**Spanish patterns (accent-stripped input via `stripAccents()`):**

| Priority | Pattern (keywords) | Routes To |
|----------|--------------------|-----------|
| 1 | arregla, corregi, roto, crashea, no funciona, falla, problema, error, rompio | `coder` |
| 2 | refactorea, renombra, reorganiza, simplifica, limpia, optimiza, modulariza | `coder` |
| 3 | testea, proba, pruebas, test unitario | `tester` |
| 4 | revisa, audita, chequea, valida, seguridad | `reviewer` |
| 5 | comitear, pushear, mergear, branchear, taggear, releasear | `coder` |
| 6 | documenta, escribi doc, anota, comenta | `researcher` |
| 7 | investiga, busca, explora, analiza, resumi, compara, evalua | `researcher` |
| 8 | disena, arquitectura, planifica, diagrama, esquema, modela | `architect` |
| 9 | configura, instala, entorno, configuracion | `devops` |
| 10 | desplega, desplegar, infraestructura, servidor, despliegue | `devops` |
| 11 | implementa, crea, construi, agrega, desarrolla, genera, hace, programa | `coder` |
| 12 | base de datos, migracion, consulta, semilla | `backend-dev` |
| 13 | interfaz, estilo, pantalla, formulario, boton, navegacion, tema | `frontend-dev` |
| 14 | que, como, por que, cuando, donde, quien, cual, podes, podrias, decime, mostrame, explica, describi, chequea, verifica, hay, tenemos, ayuda (prompt-start only) | `researcher` (0.6) |

### Pattern Priority and Conflicts

Because first-match wins, pattern order is deliberately structured:

1. **Specific intent first:** Fix/debug/refactor patterns match before broad domain patterns. "Fix the API endpoint" routes to `coder` (fix intent) not `backend-dev` (api domain).
2. **Action verbs before domain nouns:** "implement the frontend" routes to `coder` (implement intent) before `frontend-dev` (frontend domain).
3. **Spanish patterns interleaved:** Each Spanish pattern group follows its English equivalent in priority.

Word boundary behavior:
- **English patterns** use `\b` to prevent substring false positives (e.g., "checking" won't match "check" in reviewer pattern).
- **Spanish patterns** omit `\b` because JavaScript's `\b` treats accented characters as non-word characters. Instead, `stripAccents()` normalizes the task input (NFD decomposition + strip combining marks) before matching, so patterns work whether the user types accented (`arreglá`) or unaccented (`arregla`) forms.
- **Conversational patterns** (priority 14) are anchored with `^` to match only at the start of the prompt, reducing false positives on prompts that contain question words mid-sentence.

### Default Routing

When no pattern matches, the function returns:
```javascript
{ agent: 'coder', confidence: 0.5, reason: 'Default routing - no specific pattern matched' }
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

1. **Persist prompt history**: Append current prompt (up to 500 chars) to `intelligence/prompt-history.json`, keeping the last 5 entries keyed by `CLAUDE_SESSION_ID`. Resets automatically when the session ID changes.

2. **Record in session memory**: Call `createSessionMemory().recordPrompt(prompt)` to track the prompt for downstream context snapshots and feedback loops.

3. **Query daemon** (unified): Call `queryDaemon({prompt, project, session_id, limit: 5, type: 'route+inject'})` via Unix socket (`~/.quoth/daemon.sock`). The daemon handles pattern ranking, doc chunk retrieval, and routing in a single round-trip. `ensureDaemon()` is called first — starts the daemon process if the socket is absent or unresponsive.

4. **Inject relevant patterns**: From `resp.patterns`. Records exposure via `recordExposure(db, ids)` and injection via `sm.recordInjection(ids)`. Output format:
   ```
   [Quoth] Patterns for this prompt:
   - [0.42] pattern-name: action summary...
   - [0.31] pattern-name: action summary...
   ```

5. **Inject relevant doc chunks**: From `resp.doc_chunks`. Filters by `score > 0.2`. Output format:
   ```
   [Quoth Docs] Relevant project context:
     • [doc-title] content snippet...
   ```

6. **Route the task**: Agent, confidence, and reason come from daemon response fields `resp.agent`, `resp.agent_confidence`, `resp.agent_reason`. Alternatives from `resp.alternatives`.

7. **Format output**: Produce a structured table for Claude Code:
   ```
   [INFO] Routing task: <first 80 chars of prompt>

   Routing Method
     - Method: semantic+keyword
     - Backend: quoth-daemon
     - Latency: <actual ms> (embed: <embed_ms>ms, search: <search_ms>ms)
     - Matched Pattern: <reason from daemon>

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

Note: The "Estimated Metrics" section (success probability, duration, complexity) is hardcoded and not derived from any actual analysis. Latency is the actual wall-clock time of the daemon round-trip including embedding and search breakdown.

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
    +---> Save prompt history (last 5, session-keyed)
    |
    +---> sessionMemory.recordPrompt()
    |
    +---> ensureDaemon() ---------> Unix socket ~/.quoth/daemon.sock
    |
    +---> queryDaemon({type: 'route+inject'})
    |         |                        (single round-trip: embed + search + route)
    |         v
    |     resp.patterns -----------> recordExposure() + recordInjection()
    |         |                        [Quoth] Patterns for this prompt: ...
    |     resp.doc_chunks ---------> filter score > 0.2
    |         |                        [Quoth Docs] Relevant project context: ...
    |     resp.agent/confidence/reason
    |     resp.alternatives
    |         v
    |     Format and output routing table
    |       (Method: semantic+keyword, Backend: quoth-daemon,
    |        Latency: actual ms with embed/search breakdown)
    |
    v
[Routed to agent with context]
```

## Current Limitations

1. **Keyword-only routing decision**: The agent-type routing decision uses regex patterns with no semantic understanding. Tasks like "optimize the rendering pipeline" might not match any pattern despite being clearly a `frontend-dev` task. (Note: the daemon does use embeddings for pattern *injection*, but not for the routing *decision* itself.)

2. **No learned routing patterns**: The system does not learn from past routing decisions. A task that was successfully completed by a `backend-dev` after being routed to `coder` does not improve future routing for similar tasks.

3. **No project-specific routing**: All projects use the same keyword patterns. A project that is predominantly frontend work still routes through the same generic patterns.

4. **Static confidence values**: Routing confidence is 0.8 (standard match), 0.6 (conversational/question patterns), or 0.5 (default). There is no mechanism to learn that certain patterns are more reliable predictors than others.

5. **Alternative selection is uninformed**: Alternatives are always the next two agents in insertion order, regardless of task content.

6. **Hardcoded metrics**: The success probability, duration, and complexity in the hook output are static values that provide no real information.

### Improvements in v3.3.0

The following limitations from v3.2.0 have been addressed:

- ~~High default routing fallback rate~~ — Expanded from 8 to ~28 pattern groups including fix/debug/refactor/config/git/docs/conversational categories. Spanish language support added with Argentine voseo forms.
- ~~Pattern overlap ("check" false positives)~~ — Word boundaries (`\b`) added to English patterns to prevent substring matches. "checking" no longer triggers "check" in the reviewer pattern.
- ~~Accent sensitivity in Spanish matching~~ — `stripAccents()` normalizes input before matching, so accented and unaccented forms work interchangeably.
- ~~Direct pattern/embedding calls in hook~~ — Route handler now delegates to the daemon via Unix socket (single `route+inject` query), reducing hook latency and centralizing ranking logic.

## Exported API

`routing.js` exports:

| Export | Type | Description |
|--------|------|-------------|
| `routeTask(task)` | Function | Returns `{ agent, confidence, reason }` |
| `getAlternatives(primaryAgent)` | Function | Returns array of 2 alternatives |
| `AGENT_CAPABILITIES` | Object | Map of agent name to capability tags |
| `AGENT_TYPES` | Array | `Object.keys(AGENT_CAPABILITIES)` -- canonical list of domain role types |
| `TASK_PATTERNS` | Array | Array of `[RegExp, agentType, confidence?]` tuples, tested in order |
