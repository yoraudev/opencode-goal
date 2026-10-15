import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { COMMAND, DEFAULT_MAX_TURNS, TOOL, afterTurn, claim, continuation, evaluatorPrompt, needsCheck, parseCommand, parseVerdict, pause, reminder, renderTranscript, resume, start, statusText } from "./goal.js"

export const STATE_KEY = "goal"
export const NOTICE_KEY = "goalNotice"
const storageKey = (sessionID) => `goal:${sessionID}`
const PAUSING = new Set(["user", "inactivity"])

export function remind(messages, text) {
  const index = messages.findLastIndex((message) => message.role === "user")
  if (index < 0) return
  const message = messages[index]
  const content = typeof message.content === "string" ? `${message.content}\n\n${text}` : [...message.content, { type: "text", text }]
  messages[index] = Object.assign(Object.create(Object.getPrototypeOf(message)), message, { content })
}

const goalTool = (record) => ({
  name: TOOL,
  description: "Reports that the goal the user set with /goal is achieved, or that you are blocked on something only the user can provide. Only available while a goal is active. Call it once, as the last action of the turn.",
  input: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["achieved", "blocked"], description: '"achieved" when every part of the goal is done and verified; "blocked" when you cannot continue without the user.' },
      summary: { type: "string", description: "For achieved: what was done and how it was verified. For blocked: exactly what you need from the user." },
    },
    required: ["status", "summary"],
    additionalProperties: false,
  },
  options: { codemode: false },
  execute: async ({ status, summary }, context) => ({ content: await record(context.sessionID, status, summary) }),
})

export function createGoals({ storage, session, generate, maxTurns = DEFAULT_MAX_TURNS, evaluatorModel, note = () => {} }) {
  const states = new Map()
  const busy = new Set()

  const get = async (sessionID) => {
    if (!states.has(sessionID)) states.set(sessionID, (await storage.get(storageKey(sessionID)).catch(() => undefined)) ?? null)
    return states.get(sessionID)
  }

  const publish = async (sessionID, changes) => {
    try {
      const info = await session.get({ sessionID })
      const metadata = { ...info?.metadata }
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete metadata[key]
        else metadata[key] = value
      }
      await session.update({ sessionID, metadata })
    } catch (error) {
      note("metadata", sessionID, error.message)
    }
  }

  const save = async (sessionID, state, notice) => {
    states.set(sessionID, state)
    if (state) await storage.set(storageKey(sessionID), state)
    else await storage.remove(storageKey(sessionID))
    const changes = { [STATE_KEY]: state }
    if (notice) changes[NOTICE_KEY] = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...notice }
    await publish(sessionID, changes)
    note("state", sessionID, JSON.stringify(state))
  }

  const tell = (sessionID, variant, message) => publish(sessionID, { [NOTICE_KEY]: { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, variant, message } })

  const proceed = (sessionID, state) => session.synthetic({ sessionID, text: continuation(state), description: "Goal: keep going", metadata: { goal: "continue" } })

  const check = async (sessionID, state) => {
    try {
      const messages = await session.context({ sessionID })
      const model = evaluatorModel ?? (await session.get({ sessionID }).catch(() => undefined))?.model
      const prompt = evaluatorPrompt(state, renderTranscript(messages))
      const answer = await generate.text(model ? { prompt, model: { providerID: model.providerID, id: model.id } } : { prompt })
      note("verdict", sessionID, answer.text)
      return parseVerdict(answer.text)
    } catch (error) {
      return { error: error.message }
    }
  }

  const settle = async (sessionID) => {
    const state = await get(sessionID)
    if (state?.status !== "active" || busy.has(sessionID)) return
    busy.add(sessionID)
    try {
      const verdict = needsCheck(state) ? await check(sessionID, state) : undefined
      if (states.get(sessionID) !== state) return
      if (verdict?.error) return await save(sessionID, pause(state, `The independent check failed: ${verdict.error}`), { variant: "error", message: `The goal is paused: the independent check failed (${verdict.error}). Run /goal resume to try again.` })
      const { state: next, next: step } = afterTurn(state, verdict)
      if (next.status === "done") return await save(sessionID, next, { variant: "success", message: `Goal achieved after ${next.turn} turns. ${next.reason ?? ""}`.trim() })
      if (next.status === "paused") return await save(sessionID, next, { variant: "warning", message: `The goal is paused: ${next.reason}. Run /goal resume to continue.` })
      await save(sessionID, next)
      if (step === "continue") await proceed(sessionID, next)
    } finally {
      busy.delete(sessionID)
    }
  }

  const halt = async (sessionID, reason) => {
    const state = await get(sessionID)
    if (state?.status !== "active") return
    await save(sessionID, pause(state, reason), { variant: "warning", message: `The goal is paused: ${reason}. Run /goal resume to continue.` })
  }

  return {
    get,
    tool: goalTool(async (sessionID, status, summary) => {
      const state = await get(sessionID)
      if (state?.status !== "active") return "There is no active goal in this session."
      await save(sessionID, claim(state, { status, summary }))
      return status === "achieved" ? "Recorded. End your turn now; an independent check will review the work." : "Recorded. End your turn now; the goal is paused until the user answers."
    }),
    async command({ sessionID, prompt, delivery }) {
      const parsed = parseCommand(prompt.text)
      const state = await get(sessionID)
      if (parsed.action === "status") return tell(sessionID, "info", statusText(state))
      if (parsed.action === "stop") {
        if (!state) return tell(sessionID, "info", "No goal is set in this session.")
        return save(sessionID, null, { variant: "info", message: "The goal is stopped." })
      }
      if (parsed.action === "resume") {
        if (state?.status !== "paused") return tell(sessionID, "info", state ? `The goal is ${state.status}; there is nothing to resume.` : "No goal is set in this session.")
        const resumed = resume(state)
        await save(sessionID, resumed, { variant: "info", message: "The goal is resumed." })
        return void (await proceed(sessionID, resumed))
      }
      const begun = start(parsed.objective, { maxTurns })
      await save(sessionID, begun, { variant: "info", message: `Goal set. Up to ${begun.maxTurns} turns.` })
      await session.prompt({ ...prompt, sessionID, text: parsed.objective, delivery, metadata: { goal: "start" } })
    },
    async onContext(context) {
      const state = await get(context.sessionID)
      if (state?.status !== "active") {
        delete context.tools[TOOL]
        return
      }
      remind(context.messages, reminder(state))
    },
    async onEvent(event) {
      const sessionID = event.data?.sessionID
      if (!sessionID) return
      if (event.type === "session.execution.succeeded") return settle(sessionID)
      if (event.type === "session.execution.interrupted" && PAUSING.has(event.data.reason)) return halt(sessionID, event.data.reason === "user" ? "interrupted by the user" : "the session went inactive")
      if (event.type === "session.execution.failed") return halt(sessionID, `the turn failed (${event.data.error?.message ?? "unknown error"})`)
    },
  }
}

export default Plugin.define({
  id: "opencode-goal",
  async setup(ctx) {
    const debug = ctx.options.debug || process.env.OPENCODE_GOAL_DEBUG
    const note = (...parts) => debug && appendFileSync(join(tmpdir(), "opencode-goal.log"), `${new Date().toISOString()} ${parts.join(" ")}\n`)
    const maxTurns = Number.isInteger(ctx.options.maxTurns) && ctx.options.maxTurns > 0 ? ctx.options.maxTurns : DEFAULT_MAX_TURNS
    const goals = createGoals({ storage: ctx.storage, session: ctx.session, generate: ctx.generate, maxTurns, evaluatorModel: ctx.options.evaluatorModel, note })

    await ctx.tool.transform((editor) => editor.add(goals.tool))
    await ctx.command.transform((editor) =>
      editor.add({
        name: COMMAND,
        description: "Work on a task until it is done: /goal <task>, /goal status, /goal stop, /goal resume",
        execute: (invocation) => goals.command(invocation),
      }),
    )
    await ctx.session.hook("context", (context) => goals.onContext(context))

    const events = ctx.event.subscribe()[Symbol.asyncIterator]()
    const follow = async () => {
      for (;;) {
        const { value: event, done } = await events.next()
        if (done) return
        if (!event.type?.startsWith("session.execution.")) continue
        note("event", event.type, event.data?.sessionID, event.data?.reason ?? "")
        goals.onEvent(event).catch((error) => note("error", event.type, error.stack ?? error.message))
      }
    }
    follow().catch((error) => console.error("[opencode-goal] event stream ended:", error.message))

    return () => events.return?.()
  },
})
