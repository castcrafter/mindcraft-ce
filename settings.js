const settings = {
    "minecraft_version": "1.21.6", // or specific version like "1.21.6"
    "host": "localhost", // or "localhost", "your.ip.address.here"
    "port": 55916, // set to -1 to automatically scan for open ports
    "auth": "offline", // or "microsoft"

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 8080,
    "auto_open_ui": false, // opens UI in browser on startup
    
    "base_profile": "assistant", // survival, assistant, creative, or god_mode
    "profiles": [
        "./andy.json",
        // "./profiles/gpt.json",
        // "./profiles/claude.json",
        // "./profiles/gemini.json",
        // "./profiles/llama.json",
        // "./profiles/qwen.json",
        // "./profiles/grok.json",
        // "./profiles/mistral.json",
        // "./profiles/deepseek.json",
        // "./profiles/mercury.json",
        // "./profiles/andy-4.json", // Supports up to 75 messages!

        // using more than 1 profile requires you to /msg each bot indivually
        // individual profiles override values from the base profile
    ],

    "use_function_calling": true, // THIS IS EXPERIMENTAL AND MAY CAUSE ISSUES. USE AT YOUR OWN RISK.

    "load_memory": false, // legacy conversation memory; persistent agent state below is independent
    "init_message": "Respond with hello world and your name", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly

    "speak": false,
    // allows all bots to speak through text-to-speech. 
    // specify speech model inside each profile with format: {provider}/{model}/{voice}.
    // if set to "system" it will use basic system text-to-speech. 
    // Works on windows and mac, but linux requires you to install the espeak package through your package manager eg: `apt install espeak` `pacman -S espeak`.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "render_bot_view": false, // enable only when the runtime provides Xvfb/display support

    "use_brain_agent": true, // enables BrainAgent orchestrator that delegates to TaskAgent/CodeAgent
    "allow_insecure_coding": false, // lets the model write/run code on your computer; enable only in an isolated container
    "allow_vision": false, // enable only with a configured vision model and display support

    // Agent-system persistence and autonomous goals
    "agent_state_enabled": true, // stores goals, recent memory and task checkpoints in bots/<name>/agent_state.json
    "resume_active_task": true, // resume an interrupted task after process/container restart
    "persistent_memory_max_events": 120, // rolling on-disk event journal
    "persistent_memory_context_events": 12, // recent journal entries injected into planning prompts
    "task_checkpoint_messages": 30, // active task messages retained for crash recovery
    "task_context_messages": 40, // active TaskAgent context window (system prompt is always retained)
    "task_max_steps": 50,
    "task_max_no_tool_streak": 3,
    "task_max_model_failures": 3,
    "autonomy_continue_delay_ms": 3000,
    "autonomy_max_consecutive_failures": 5,

    // Short, throttled progress messages in Minecraft chat
    "progress_chat": true,
    "progress_chat_show_tools": true,
    "progress_chat_show_plans": true,
    "progress_chat_min_interval_ms": 2500,
    "progress_chat_interval_ms": 12000,
    "progress_chat_max_length": 120,
    "progress_chat_prefix": "› ",
    "blocked_actions" : ["checkBlueprint", "checkBlueprintLevel", "getBlueprint", "getBlueprintLevel"] , // commands to disable and remove from docs. Ex: ["!setMode"]
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 5, // number of relevant code function docs to select for prompting. -1 for all

    "max_messages": 15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "full", // "full", "shortened", or "none"
    "narrate_behavior": true, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 30, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
  
    "log_level": "info", // DEBUG, INFO, WARN, ERROR, NONE
    "log_module_levels": {}, // per-module overrides, e.g. {"BrainAgent": "debug"}

    "log_all_prompts": false, // log ALL prompts to file



    // ONLY ADD REPOS YOU TRUST AND ONLY ENABLE AUTO INSTALL IF YOU UNDERSTAND THE RISKS
    // YOU CAN "INSTALL" and "UPDATE" MODELS MANUALLY THROUGH THE MINDSERVER UI
    "model_provider_repositories": [
        {
            "url" : "http://link_to_github.com/manifest.json", 
            "auto_install_and_update": true
        }
    ],

    // ONLY ADD REPOS YOU TRUST AND ONLY ENABLE AUTO INSTALL IF YOU UNDERSTAND THE RISKS
    // YOU CAN "INSTALL" and "UPDATE" TOOLS MANUALLY THROUGH THE MINDSERVER UI
    "tools_provider_repositories": [
        {
            "url" : "http://link_to_github.com/manifest.json", 
            "auto_install_and_update": true
        }
    ]
}

if (process.env.SETTINGS_JSON) {
    try {
        Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON));
    } catch (err) {
        console.error("Failed to parse SETTINGS_JSON:", err);
    }
}

export default settings;
