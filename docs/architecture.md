# Architecture

OpenCode Goal is a single OpenCode 2 plugin with a server part and a terminal UI part, loaded from the same `plugin` directory. There is no daemon and no build step.

```
/goal <task> ──> server plugin ──prompt / synthetic──> session
                     │   ▲
                     │   └── session.execution.* events, goal_done calls
                     ├──> ctx.generate (independent check)
                     └──> session metadata (goal, goalNotice) ──> terminal UI plugin
```

| File | Runs in | Role |
| --- | --- | --- |
| `plugin/goal.js` | Both | The logic without the host: command parsing, goal state and its transitions, the texts sent to the models, transcript rendering and verdict parsing |
| `plugin/server.js` | OpenCode server process | The `/goal` command, the `goal_done` tool, the `context` hook and the loop that follows the session events |
| `plugin/tui.jsx` | OpenCode terminal UI process | The footer indicator, the toasts and the `goal-status` and `goal-stop` commands |

## Goal state

A goal belongs to one session. Its state is a plain object:

| Field | Meaning |
| --- | --- |
| `objective` | The text given to `/goal` |
| `status` | `active`, `paused` or `done` |
| `turn`, `maxTurns`, `budget` | Turns finished so far, the limit, and the limit the goal started with |
| `claim` | The `goal_done` call of the current turn, `{ status, summary }`, cleared after the turn |
| `feedback` | The last reason the independent check gave for rejecting a claim |
| `reason` | Why the goal is paused or what the check said when it finished |
| `started`, `finished` | ISO timestamps |

`goal.js` changes it only through `start`, `claim`, `pause`, `resume`, `finish` and `afterTurn`, which return a new object. `afterTurn` counts the turn and decides what follows:

| Turn ended with | Result |
| --- | --- |
| A `blocked` claim | `paused`, with the claim's summary as the reason |
| An `achieved` claim the check confirmed | `done` |
| An `achieved` claim the check rejected | `feedback` set, then as below |
| No claim | `continue`, or `paused` when `turn` has reached `maxTurns` |

`resume` sets the goal `active` again and, when it stopped at the limit, raises `maxTurns` by `budget`.

## Server plugin

`plugin/server.js` exports `createGoals`, which takes the host's `storage`, `session` and `generate` objects as arguments and holds the behavior, so the tests run it with fakes. The default export is the Promise plugin for `@opencode/plugin` 2.x that builds it from `ctx`.

The state is kept in a map, in the plugin's storage under `goal:<sessionID>`, and in the session's metadata under `goal`, which is how the terminal UI learns about it. Session metadata is replaced as a whole on update, so the plugin reads the session first and writes the other keys back unchanged. Messages meant for the user go to the `goalNotice` metadata key with a unique `id`, a `variant` and a `message`; nothing is written into the conversation for them.

| Registration | What the plugin does |
| --- | --- |
| Command `goal` | OpenCode passes only the text after `/goal`. `status` and an empty text post a notice with the state; `stop` deletes the state; `resume` resumes a paused goal and sends a continuation; any other text starts a goal and sends it as a prompt, keeping the attachments of the original input |
| Tool `goal_done` | Records `{ status, summary }` as the claim of the active goal of the calling session and tells the model to end its turn |
| `session` `context` | Without an active goal, removes `goal_done` from the tools of the request. With one, appends the reminder to the last user message of the request |
| Event stream | Follows `session.execution.succeeded`, `interrupted` and `failed` |

On `session.execution.succeeded` for a session with an active goal, the plugin runs the independent check if the turn ended with an `achieved` claim, applies `afterTurn` and saves the result. On `continue` it sends the continuation with `session.synthetic`, which wakes the session and starts the next turn. A per-session guard keeps two events from being handled at once, and when the state changed while the check was running, for example through `/goal stop`, the result is discarded.

`session.execution.interrupted` with the reason `user` or `inactivity` pauses the goal, and so does `session.execution.failed`. The reasons `superseded` and `shutdown` leave it active.

### Independent check

The check reads the session's messages with `session.context`, renders the newest of them into at most 24,000 characters with `renderTranscript` (user messages, synthetic messages, assistant text and tool calls with their input, status and output, each piece cut at 1,500 characters; reasoning is left out), and sends `evaluatorPrompt` through `ctx.generate.text`. It uses the `evaluatorModel` option, or the session's current model when that is not set.

`parseVerdict` removes `<think>` blocks, takes the last JSON object with a boolean `done`, and falls back to reading `"done": true` or `false` from broken JSON. An answer without a verdict counts as not done. If the request itself fails, the goal is paused, so a missing model cannot run the goal to its turn limit.

## Terminal UI plugin

`plugin/tui.jsx` adds a contribution to the `prompt.footer.status` slot that shows the goal of the session in the prompt's footer. It reads the state from a Solid signal that it fills from `session.metadata.updated` events, and from the session's metadata in `ctx.data` before the first event arrives.

The same event handler shows a toast for each `goalNotice` whose `id` it has not seen, and asks OpenCode for a desktop notification and a sound when a goal is done, paused or failed. The ids already in the sessions' metadata when the plugin starts are marked as seen, so old notices are not shown again.

It registers two commands in the `global` keymap mode, with slash names and command palette entries: `goal.status` (`/goal-status`) opens an alert with the state of the current session's goal, and `goal.stop` (`/goal-stop`) sends `/goal stop` to the server through `client.session.command`.

`tui.jsx` is the only file with JSX. OpenCode compiles it when it loads the plugin and supplies `solid-js` and the OpenTUI elements.

## Texts given to the model

`goal.js` holds every text a model reads. The reminder tells the agent the goal, the turn and the limit, that it gets another turn automatically, to work without asking for confirmation, to call `goal_done` with `achieved` only after verifying the work and with `blocked` when only the user can help, and repeats the last rejection. The continuation repeats the goal and the rejection, if any, and asks for the next concrete step. The evaluator prompt asks for a single JSON object and tells the check to judge only from the transcript and to accept a goal only when the transcript shows it was verified.

## Releases

`.github/workflows/release.yml` runs on every push to `main`: unit tests, compute the next version (major and minor from `package.json`, patch one higher than the latest matching tag), and publish a release with the packed project.

## Tests

`test/goal.test.mjs` covers command parsing, the state transitions (continuing, a confirmed and a rejected claim, a blocked claim, the turn limit and resuming past it), the reminder and status texts, verdict parsing (thinking blocks, code fences, broken JSON, no verdict) and transcript rendering within a limit. `test/server.test.mjs` drives `createGoals` with fake storage, session and generate objects: starting a goal with its attachments, offering the tool and the reminder only while a goal is active, continuing, checking a claim with the session's model and finishing, pausing on a failed check, the turn limit, interrupts and failures, a blocked claim, `/goal stop` keeping other metadata, `/goal status`, and a stop that arrives while the check is running.
