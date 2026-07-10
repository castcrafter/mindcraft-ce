# Agent-system implementation audit

This audit covers the experimental `agent-system` branch and the productionization changes on `codex/agent-system-production`.

## Confirmed problems in the original branch

- Goals, BrainAgent history, RP notes, named places, and running TaskAgent state existed only in memory.
- The legacy `History` save path was bypassed by the BrainAgent route, so `$MEMORY` was usually empty or stale.
- A process or container restart could not continue a running TaskAgent operation.
- Long-running goals depended on a new user prompt after every completed or failed task.
- Concurrent incoming messages could be dropped into the Brain-to-Task queue even when no task was running.
- Starting a new task while another task was active could create competing TaskAgent loops.
- Manual `!tool(...)` chat commands were passed to `executeTool` in the wrong shape.
- Tool discovery was asynchronous but not awaited before tool definitions were requested.
- Tool blacklisting mutated a global list, so one agent's profile could remove tools from every agent.
- `searchMemory` called a RAG method that was explicitly unimplemented; the LanceDB memory schema was empty.
- The DeepSeek adapter referenced an undeclared `function_calls`, sent unsupported `json_schema`, lost tool-call context, and had no safe stream recovery.
- A clean dependency install failed because an obsolete Mineflayer patch targeted a different package version.
- Generated augment files used incorrect relative imports and were not added to live tool definitions.
- Word-overlap skill fallback compared text against embedding arrays and could crash.
- Full lint exposed real undefined-variable paths in the legacy coder, conversation handling, NPC hunting, and several model adapters.
- `start.sh` unconditionally required `xvfb-run`, which is absent from generic Pterodactyl Node images.

## Implemented

- Atomic per-agent JSON state with bounded journal memory and corruption fallback.
- Persistent goals, checklist state, active goal, autonomy state, RP notes, named places, and Brain history.
- Per-step active-task checkpoints and automatic restart recovery.
- Autonomous re-planning after each bounded task, with retry delay and failure circuit breaker.
- Explicit `setGoal`, `goalStatus`, `pauseGoal`, `resumeGoal`, and `clearGoal` tools.
- Compatibility recovery that converts known model-written legacy `!tool(...)` text, including case/hyphen aliases, into validated internal tool calls.
- Serialized incoming message processing and safe injection/cancellation of running tasks.
- Throttled Minecraft progress reporter with public plan summaries and human-readable tool activity.
- DeepSeek streaming, thinking/tool-call continuity, supported JSON mode, retries, and non-stream fallback.
- Persistent keyword-search memory wired into `searchMemory` and the Brain/Task prompts.
- Agent-specific tool filtering.
- Deterministic dependency lockfile and removal of obsolete patches.
- Correct augment imports, validation, persistence, and live registration.
- Working headless startup without Xvfb.
- Meaningful full-project lint and unit tests for state, goals, tool loading, command parsing, progress, and DeepSeek stream parsing.

## Remaining limitations

- A real Minecraft server plus provider API credentials is required for end-to-end movement, combat, Nether, stronghold, and Dragon validation. Those world-level scenarios are not simulated by the unit suite.
- The checked-out experimental branch is significantly behind current `develop`. This work intentionally avoids a high-risk bulk merge; selected upstream changes should be integrated separately.
- `searchWiki` depends on a populated local LanceDB table. With an empty database it returns no results; no live web scraper is bundled.
- Persistent event search is deterministic keyword matching, not semantic vector retrieval. It is sufficient for recent recovery but is not a full episodic-memory embedding system.
- Vision-originated tool calls are still marked unimplemented in `vision_interpreter.js`. Vision and bot rendering also require display/native dependencies.
- Provider adapters were statically checked and obvious undefined-variable failures were repaired, but only the DeepSeek request/stream shape has dedicated mocked tests in this branch. Live provider behavior can change independently.
- Legacy SelfPrompter and legacy conversation memory remain for compatibility. New long-running work should use persistent BrainAgent goals.
- Model-generated code remains inherently unsafe. It is disabled by default and was not made a security boundary by these changes.
- The parent process intentionally stops restarting an agent that crashes again within ten seconds. Persistent state remains available, but an operator must correct the startup failure.
- `npm audit --omit=dev` currently reports 6 high and 11 moderate transitive advisories. The high findings originate from the `node-canvas-webgl -> gl -> node-gyp -> tar` native-build chain and npm reports no fix; the moderate UUID findings are in the Mineflayer authentication chain and also report no fix. Keep the container isolated and rebuild when upstream dependencies publish fixes.

## Verification performed

- JavaScript syntax check across repository source files.
- Full ESLint run with Node/browser globals and vendored Handlebars excluded.
- Node unit suite covering persistent state, bounded/searchable memory, goal serialization, tool discovery, manual command parsing, progress throttling, DeepSeek JSON conversion, and streamed reasoning/tool-call assembly.
- `patch-package` installation pass against the locked dependency tree.

Live Minecraft and real paid API calls are deliberately not part of automated CI validation.
