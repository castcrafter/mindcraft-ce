# Persistent Agent System

This branch turns the experimental BrainAgent/TaskAgent code into a restart-safe agent loop. It is designed for long Minecraft objectives such as progressing through survival and defeating the Ender Dragon.

## What is persistent

Every bot writes `bots/<bot-name>/agent_state.json`. The file contains:

- goals, priorities, checklists, active goal, and pause state;
- a bounded recent-memory event journal;
- BrainAgent context and per-player RP notes;
- named places such as a portal or death position;
- the active task prompt, recent model/tool context, current step, and last verified report.

Writes are atomic. If the state file cannot be parsed, it is copied to a timestamped `.corrupt-*` backup and the agent starts with a fresh state instead of crashing.

An interrupted task is resumed after spawn. The TaskAgent is explicitly told to inspect the current world state and not assume that the action interrupted by the crash succeeded. Completed, cancelled, or stalled tasks are not replayed blindly; an active autonomous goal is sent back to the BrainAgent so it can choose the next bounded subtask.

Legacy `memory.json` is still supported when `load_memory=true`, but the new persistent state works independently and is enabled by default.

## Defining and controlling a goal

You can use normal language:

> Set your persistent primary goal to beat Minecraft in survival. Work autonomously until the Ender Dragon is defeated. Report progress briefly and pause if you repeatedly cannot make progress.

For deterministic control, use these Minecraft chat commands:

```text
!setGoal("Beat Minecraft","Defeat the Ender Dragon in survival")
!goalStatus()
!pauseGoal()
!resumeGoal()
!clearGoal()
```

`setGoal` enables autonomous work. The BrainAgent prompt already includes a survival progression baseline covering equipment, food, portals, Nether preparation, fortress and Blaze safety, Eyes of Ender, stronghold tracking, End preparation, crystals, and the Dragon fight. The agent must adapt that baseline to observed game state.

Autonomy stops automatically after `autonomy_max_consecutive_failures` failed subtasks. This prevents an expensive infinite retry loop. Use `!resumeGoal()` after correcting the underlying problem.

## Progress in Minecraft chat

The progress channel is enabled by default and deliberately does not expose hidden chain-of-thought. It shows:

- a short model-generated, player-safe plan summary;
- the current task and recovery point;
- human-readable tool actions such as wiki search, crafting, travelling, placing, or fighting;
- occasional generic planning phases while a slow model request is running;
- failures and pause/recovery events.

Messages are deduplicated and rate-limited. Relevant settings are:

```json
{
  "progress_chat": true,
  "progress_chat_show_tools": true,
  "progress_chat_show_plans": true,
  "progress_chat_min_interval_ms": 2500,
  "progress_chat_interval_ms": 12000,
  "progress_chat_max_length": 120
}
```

Native function calling is the preferred execution path. If a model nevertheless emits an old inline command such as `!nearbyBlocks()` or `!nearby-blocks`, the TaskAgent recognizes known tool names and aliases, converts them to an internal tool call, executes the tool, and feeds the result back into the task loop. Unknown text commands are never executed.

## DeepSeek

`profiles/deepseek.json` uses the current DeepSeek model, streaming, thinking mode, and retries. The adapter:

- converts the repository's JSON Schema format to DeepSeek JSON Object mode;
- preserves `reasoning_content`, assistant tool calls, and tool-call IDs where the API requires them for the next tool turn;
- consumes streamed content and tool-call deltas;
- retries transient API/CDN errors;
- retries a broken stream once without streaming for that request;
- requests identity encoding to avoid the observed truncated-gzip failure.

Only `DEEPSEEK_API_KEY` is required. DeepSeek has no embedding endpoint, so examples and skill selection automatically fall back to local word-overlap matching when no separate embedding model is configured.

## Pterodactyl / server-only installation

The published working branch is `codex/agent-system-production` in `castcrafter/mindcraft-ce`.

From a server console with Git access:

```bash
cd /home/container
git remote set-url origin https://github.com/castcrafter/mindcraft-ce.git
git fetch origin codex/agent-system-production
git checkout -B codex/agent-system-production origin/codex/agent-system-production
npm ci --include=dev --no-audit --no-fund
node main.js
```

Do not use `git pull --rebase` over a conflicted installation. Back up `bots/`, profiles, settings, and keys first. The `bots/` directory is ignored by Git and survives normal branch updates.

The startup command can be either `node main.js` or `sh start.sh`. `start.sh` now detects whether `xvfb-run` exists and falls back to headless startup. On a generic Pterodactyl Node image, keep both `allow_vision` and `render_bot_view` disabled.

Example `SETTINGS_JSON` for a Pterodactyl environment variable:

```json
{
  "host": "127.0.0.1",
  "port": 25565,
  "auth": "offline",
  "minecraft_version": "auto",
  "base_profile": "survival",
  "profiles": ["./profiles/deepseek.json"],
  "mindserver_port": 8080,
  "auto_open_ui": false,
  "use_function_calling": true,
  "use_brain_agent": true,
  "agent_state_enabled": true,
  "resume_active_task": true,
  "progress_chat": true,
  "allow_insecure_coding": false,
  "allow_vision": false,
  "render_bot_view": false,
  "init_message": "Set a persistent primary goal to beat Minecraft in survival and work autonomously. Start by inspecting your actual state."
}
```

Provide `DEEPSEEK_API_KEY` as a separate secret environment variable. Do not put it into `SETTINGS_JSON` or commit it.

## Reset and recovery controls

- Pause without losing state: `!pauseGoal()`.
- Resume: `!resumeGoal()`.
- Inspect: `!goalStatus()` or open `bots/<name>/agent_state.json` while the server is stopped.
- Remove only the active goal: `!clearGoal()`.
- Completely reset the new state: stop the process and delete `bots/<name>/agent_state.json`.
- Keep the goal but discard an unsafe running task: stop the process, set the file's `task` field to `null`, then restart. Prefer `!pauseGoal()` during normal operation.

## Security

`allow_insecure_coding` is now disabled by default. `executeCode` and `generateAugment` let model-generated JavaScript control the process and should only be enabled inside a disposable, isolated container. Persistent goals, memory, normal tools, and crash recovery do not require coding to be enabled.
