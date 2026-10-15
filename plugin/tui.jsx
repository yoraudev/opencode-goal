import { Plugin } from "@opencode/plugin/tui"
import { Show, createSignal } from "solid-js"
import { statusText } from "./goal.js"

const STATE_KEY = "goal"
const NOTICE_KEY = "goalNotice"
const ACTIVE = "#61afef"
const DONE = "#98c379"
const PAUSED = "#e5c07b"

const label = (goal) => (goal.status === "done" ? "✓ goal done" : goal.status === "paused" ? `‖ goal paused ${goal.turn}/${goal.maxTurns}` : `◎ goal ${Math.min(goal.turn + 1, goal.maxTurns)}/${goal.maxTurns}`)
const color = (goal) => (goal.status === "done" ? DONE : goal.status === "paused" ? PAUSED : ACTIVE)

export default Plugin.define({
  id: "opencode-goal",
  setup(ctx) {
    const [goals, setGoals] = createSignal({})
    const seen = new Set(ctx.data.session.list().map((session) => session.metadata?.[NOTICE_KEY]?.id).filter(Boolean))

    const goalOf = (sessionID) => {
      if (!sessionID) return undefined
      const known = goals()
      return sessionID in known ? known[sessionID] : ctx.data.session.get(sessionID)?.metadata?.[STATE_KEY]
    }

    const unsubscribe = ctx.data.on("session.metadata.updated", (event) => {
      const { sessionID, metadata } = event.data ?? {}
      if (!sessionID) return
      setGoals((known) => ({ ...known, [sessionID]: metadata?.[STATE_KEY] ?? null }))
      const notice = metadata?.[NOTICE_KEY]
      if (!notice?.id || seen.has(notice.id)) return
      seen.add(notice.id)
      ctx.ui.toast.show({ variant: notice.variant ?? "info", title: "Goal", message: notice.message, sessionID })
      if (notice.variant === "success" || notice.variant === "warning" || notice.variant === "error") {
        void ctx.ui.attention?.notify({ title: "Goal", message: notice.message, sound: { name: notice.variant === "success" ? "done" : "error" } }).catch(() => undefined)
      }
    })

    const current = () => {
      const route = ctx.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const Indicator = (input) => (
      <Show when={goalOf(input.sessionID)}>
        {(goal) => <text fg={color(goal())}>{label(goal())}</text>}
      </Show>
    )

    const release = ctx.ui.slot({ append: "prompt.footer.status", render: Indicator })

    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "goal.status",
          title: "Goal: show status",
          description: "Show the goal of this session, its turn count and the last check",
          group: "Goal",
          bind: false,
          palette: true,
          slash: { name: "goal-status" },
          run: () => void ctx.ui.dialog.alert({ title: "Goal", message: statusText(goalOf(current()) ?? undefined) }),
        },
        {
          id: "goal.stop",
          title: "Goal: stop",
          description: "Clear the goal of this session so the agent stops continuing on its own",
          group: "Goal",
          bind: false,
          palette: true,
          enabled: () => Boolean(goalOf(current())),
          slash: { name: "goal-stop" },
          run: () => {
            const sessionID = current()
            if (!sessionID) return
            ctx.client.session.command({ sessionID, name: "goal", text: "stop" }).catch((error) => ctx.ui.toast.show({ variant: "error", title: "Goal", message: `The goal could not be stopped: ${error.message}` }))
          },
        },
      ],
    }))

    return () => {
      unsubscribe()
      release()
    }
  },
})
