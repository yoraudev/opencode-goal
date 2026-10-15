export const COMMAND = "goal"
export const TOOL = "goal_done"
export const DEFAULT_MAX_TURNS = 30
export const TRANSCRIPT_CHARS = 24000
const PIECE_CHARS = 1500

export function parseCommand(text = "") {
  const trimmed = text.trim().replace(/^\/goal\b/i, "").trim()
  const word = trimmed.toLowerCase()
  if (word === "" || word === "status") return { action: "status" }
  if (word === "stop" || word === "clear" || word === "cancel") return { action: "stop" }
  if (word === "resume" || word === "continue") return { action: "resume" }
  return { action: "start", objective: trimmed }
}

export function start(objective, { maxTurns = DEFAULT_MAX_TURNS, now = new Date() } = {}) {
  return { objective, status: "active", turn: 0, maxTurns, budget: maxTurns, claim: null, feedback: null, reason: null, started: now.toISOString(), finished: null }
}

export const claim = (state, { status, summary }) => ({ ...state, claim: { status, summary } })

export const pause = (state, reason) => ({ ...state, status: "paused", reason, claim: null })

export const resume = (state) => ({ ...state, status: "active", reason: null, maxTurns: state.turn >= state.maxTurns ? state.turn + state.budget : state.maxTurns })

export const finish = (state, reason, now = new Date()) => ({ ...state, status: "done", reason, claim: null, feedback: null, finished: now.toISOString() })

export function afterTurn(state, verdict) {
  const counted = { ...state, turn: state.turn + 1 }
  if (counted.claim?.status === "blocked") return { state: pause(counted, `Blocked: ${counted.claim.summary}`), next: "stop" }
  if (counted.claim && verdict?.done) return { state: finish(counted, verdict.reason), next: "stop" }
  const checked = counted.claim ? { ...counted, claim: null, feedback: verdict?.reason ?? "The independent check gave no verdict." } : counted
  if (checked.turn >= checked.maxTurns) return { state: pause(checked, `Reached the limit of ${checked.maxTurns} turns`), next: "stop" }
  return { state: checked, next: "continue" }
}

export const needsCheck = (state) => state?.status === "active" && state.claim?.status === "achieved"

export function reminder(state) {
  return `<system-reminder>
The user set a goal for this session with /goal. You are on turn ${state.turn + 1} of at most ${state.maxTurns}.

Goal: ${state.objective}

Work on it autonomously. Do not stop to ask for confirmation or hand steps back to the user; after each turn ends you get another one automatically until the goal is done. Each turn, pick the next concrete step and carry it out.

When the goal is fully achieved and you have verified it (for example by running the tests or checking the output), call \`${TOOL}\` with status "achieved" and a summary of what was done and how it was verified. An independent check then reviews the conversation; a premature claim is rejected and you continue. If you cannot go on without something only the user can provide, call \`${TOOL}\` with status "blocked" and say what you need.${state.feedback ? `\n\nThe last independent check rejected your claim: ${state.feedback}` : ""}
</system-reminder>`
}

export function continuation(state) {
  const intro = state.feedback ? `The independent check found the goal is not achieved yet: ${state.feedback}` : "The goal is not achieved yet."
  return `${intro}\n\nContinue working toward the goal: ${state.objective}\n\nTake the next concrete step. Call \`${TOOL}\` only when everything is done and verified.`
}

export function statusText(state) {
  if (!state) return "No goal is set in this session. Start one with /goal <task>."
  const lines = [`Goal: ${state.objective}`, `Status: ${state.status}, turn ${state.turn} of ${state.maxTurns}`]
  if (state.reason) lines.push(`Reason: ${state.reason}`)
  if (state.feedback && state.status === "active") lines.push(`Last check: ${state.feedback}`)
  return lines.join("\n")
}

const clip = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

const stringify = (value) => (typeof value === "string" ? value : JSON.stringify(value))

function toolLine(part) {
  const state = part.state ?? {}
  const input = state.input === undefined ? "" : clip(stringify(state.input), PIECE_CHARS / 3)
  const output = Array.isArray(state.content) ? state.content.map((item) => (item.type === "text" ? item.text : `[${item.mime ?? "file"}]`)).join("\n") : ""
  const result = state.status === "error" ? state.error?.message ?? "" : clip(output, PIECE_CHARS)
  return `Tool ${part.name}(${input}) → ${state.status ?? "unknown"}${result ? `: ${result}` : ""}`
}

function renderMessage(message) {
  if (message.type === "user") return `User: ${clip(message.text ?? "", PIECE_CHARS)}`
  if (message.type === "synthetic") return `Note: ${clip(message.text ?? "", PIECE_CHARS)}`
  if (message.type !== "assistant") return ""
  return (message.content ?? [])
    .map((part) => (part.type === "text" ? `Assistant: ${clip(part.text, PIECE_CHARS)}` : part.type === "tool" ? toolLine(part) : ""))
    .filter(Boolean)
    .join("\n")
}

export function renderTranscript(messages, limit = TRANSCRIPT_CHARS) {
  const pieces = []
  let used = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const text = renderMessage(messages[index])
    if (!text) continue
    if (used + text.length > limit) {
      if (pieces.length === 0) pieces.unshift(text.slice(-limit))
      break
    }
    pieces.unshift(text)
    used += text.length
  }
  return pieces.join("\n\n")
}

export function evaluatorPrompt(state, transcript) {
  return `You are checking whether an autonomous coding agent has fully achieved a goal. Judge only from the transcript below; do not trust the agent's claim unless the transcript backs it up.

Goal:
${state.objective}

The agent's claim:
${state.claim?.summary ?? ""}

Recent transcript (oldest first, long parts are cut):
${transcript}

Answer with a single JSON object and nothing else: {"done": true or false, "reason": "..."}.
Set "done" to true only if every part of the goal is achieved and the transcript shows it was verified (for example tests that ran and passed, or output that was checked). If anything required is missing, unverified, failing or only promised, set "done" to false and make "reason" say exactly what is still missing, in one or two sentences the agent can act on.`
}

export function parseVerdict(text = "") {
  const visible = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
  const candidates = visible.match(/\{[^{}]*"done"[^{}]*\}/g) ?? []
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed.done === "boolean") return { done: parsed.done, reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : parsed.done ? "The goal is achieved." : "The check did not say what is missing." }
    } catch {}
  }
  const loose = visible.match(/"done"\s*:\s*(true|false)/)
  if (loose) return { done: loose[1] === "true", reason: "The check's answer could not be fully read." }
  return { done: false, reason: "The independent check gave no clear verdict; verify the work again and state the evidence." }
}
