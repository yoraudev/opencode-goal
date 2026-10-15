# OpenCode Goal

## Tech Stack

- **Language:** JavaScript (ES modules)
- **Runtime:** OpenCode's plugin runtime
- **Layout:** `plugin/` (the OpenCode 2 plugin: `server.js`, `tui.jsx` and the host-free logic in `goal.js`), `test/`, `docs/`
- **OpenCode plugin:** `@opencode/plugin` 2.x (Promise plugin API for the `/goal` command, the `goal_done` tool, the `context` hook and the session event stream; terminal UI plugin API with Solid JSX for the status indicator, the toasts and the `goal-status` and `goal-stop` commands)
- **Server ↔ terminal UI:** the session metadata keys `goal` (the goal state) and `goalNotice` (the latest message to show as a toast)
- **Tests:** `node:test`, with the OpenCode host replaced by fakes
- **CI / releases:** GitHub Actions

## Project Rules

- Every file in the repository is written in English: code, identifiers, user-facing strings, documentation and commit messages.
- Commit messages follow Conventional Commits: `type(scope): description`, with types such as `feat`, `fix`, `chore`, `docs`, `refactor`, `test` and `ci`. Mark breaking changes with `!` after the type. Keep the subject line short and make it the best single description of the change; put the details in the commit body, written out in full.
- Commits, pull requests and anything else published to the repository carry only the repository owner's name and email. Never add AI or tool attribution: no `Co-Authored-By` trailers, no "Generated with" lines, no assistant names as author or committer.
- Do not write comments. Every hand-written file (anything that is not auto-generated) stays free of code comments, including config files such as YAML and `.gitattributes`.
- Whenever something is added to, changed in, or removed from the project, every `.md` file that references it must be updated in the same change.
