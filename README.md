# OpenCode Goal

Give OpenCode 2 a task with `/goal <task>` and the agent keeps working on it, turn after turn and without waiting for you, until the task is done and an independent check agrees.

The agent reports the goal achieved with a `goal_done` tool. A separate model request then reads the goal and the conversation and decides whether the work is really done and verified. If it is not, its reason goes back to the agent and the work continues.

> [!WARNING]
> **While a goal is active, the agent acts on its own for many turns without you reading along.** Read this before installing.
>
> Each turn the agent runs tools with whatever permissions you have given OpenCode, and the next turn starts as soon as the last one ends. Nothing in this plugin asks you before an action.
>
> What can go wrong:
>
> - **Unwanted actions.** A model that misunderstands the goal can edit, delete or overwrite work, run commands or install packages turn after turn before you notice. OpenCode 2 allows most actions by default.
> - **Cost.** Every turn is a full model request, and every claim that the goal is achieved adds one more for the check. A goal can use up to its turn limit, 30 turns by default.
> - **Premature or wrong results.** The check is a model too. It judges from a shortened transcript and can accept work that is not done, or keep rejecting work that is.
> - **Your conversation goes to the check's model.** The independent check sends the recent conversation, including tool output, to the session's model or to the model you set for it.
> - **Prompt injection.** Content the agent reads while working, such as files, web pages or command output, can try to steer it. Without you watching each turn, there is less chance to notice.
>
> How to lower the risk:
>
> - Keep OpenCode's permission prompts on for what must not happen without you, and its `deny` rules for what must never happen.
> - Work in a repository with committed history so that changes can be undone.
> - Give goals that can be verified, such as tests that must pass, and lower `maxTurns` for open-ended tasks.
> - Watch the first goals you run, and press `esc` to pause one that goes wrong.
>
> You use this at your own risk; see [LICENSE](LICENSE).

## Install

Requires OpenCode 2.

Download the package from the latest release and unpack it, or clone the repository. Then:

```bash
npm install
```

Add the `plugin` directory to `opencode.jsonc`, with its full path:

```jsonc
{
  "plugins": ["/full/path/to/opencode-goal/plugin"]
}
```

Restart OpenCode. If it runs as a background service, restart that too:

```bash
opencode service restart
```

## Use

| Command | What it does |
| --- | --- |
| `/goal <task>` | Start a goal in this session and send the task to the agent. Replaces any earlier goal |
| `/goal` or `/goal status` | Show the goal, its status and turn count in a toast |
| `/goal stop` | Clear the goal. The agent finishes the current turn and does not continue on its own |
| `/goal resume` | Continue a paused goal. If it stopped at the turn limit, the limit is raised by the goal's original number of turns |
| `/goal-status` | Show the goal in a dialog |
| `/goal-stop` | Same as `/goal stop` |

After each turn the plugin either tells the agent to take the next step, or, when the agent called `goal_done`, runs the independent check. The goal pauses when the agent reports that it is blocked on something only you can provide, when you press `esc`, when a turn fails, when the check cannot run, and when the turn limit is reached.

The prompt's footer shows `◎ goal 3/30` while a goal is active, `‖ goal paused` when it is paused and `✓ goal done` when it is achieved. A toast, and a desktop notification with a sound where OpenCode supports it, tells you when a goal is done or paused.

## Settings

Plugin options go in the entry form of `plugins`:

```jsonc
{
  "plugins": [
    {
      "package": "/full/path/to/opencode-goal/plugin",
      "options": {
        "maxTurns": 50,
        "evaluatorModel": { "providerID": "local", "id": "glm-5.3-flash" },
        "debug": true
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `maxTurns` | `30` | Turns a goal may take before it pauses |
| `evaluatorModel` | The session's model | The model that runs the independent check, as `{ "providerID", "id" }` |
| `debug` | `false` | Write a log to `opencode-goal.log` in the system's temporary directory. The `OPENCODE_GOAL_DEBUG` environment variable turns it on too |

## Good to know

- Every turn that ends while a goal is active counts toward the limit, including turns started by messages you send yourself.
- `/goal` only works where OpenCode runs commands: in the terminal UI. `opencode run "/goal …"` sends the text to the model as a normal prompt.
- The goal is kept in the plugin's storage and survives a restart. If OpenCode exits during a turn, the goal stays active but nothing starts the next turn; send a message to continue.
- `/goal stop` does not interrupt a turn that is running. Press `esc` for that.
- The check reads about the last 24,000 characters of the conversation, with long tool outputs cut. Work that happened earlier and is not repeated near the end may be missed, so the reminder asks the agent to state its evidence when it reports the goal achieved.
- Subagent sessions do not see the goal or the `goal_done` tool.
- Developed on Windows 11 against OpenCode 2.0.29. It has not been run on Linux or macOS yet.

## Development

```bash
npm test
```

How the pieces fit together is described in [docs/architecture.md](docs/architecture.md). Every push to `main` publishes a new release.

## License

Free to use, modify and redistribute, as long as the original author stays credited and the project is not presented as someone else's own. See [LICENSE](LICENSE).
