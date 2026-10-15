import assert from "node:assert/strict"
import { test } from "node:test"
import { TOOL } from "../plugin/goal.js"
import { NOTICE_KEY, STATE_KEY, createGoals, remind } from "../plugin/server.js"

function fakeHost({ verdicts = [], failCheck = false } = {}) {
  const log = { prompts: [], synthetic: [], generated: [], metadata: {} }
  const store = new Map()
  const storage = {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
    remove: async (key) => void store.delete(key),
  }
  const session = {
    get: async ({ sessionID }) => ({ id: sessionID, metadata: log.metadata[sessionID], model: { providerID: "local", id: "glm" } }),
    update: async ({ sessionID, metadata }) => void (log.metadata[sessionID] = metadata),
    prompt: async (input) => void log.prompts.push(input),
    synthetic: async (input) => void log.synthetic.push(input),
    context: async () => [{ type: "user", text: "task" }, { type: "assistant", content: [{ type: "text", text: "done, tests pass" }] }],
  }
  const generate = {
    text: async (input) => {
      log.generated.push(input)
      if (failCheck) throw new Error("no model")
      return { text: verdicts.shift() ?? '{"done": false, "reason": "nothing verified"}' }
    },
  }
  return { log, store, goals: createGoals({ storage, session, generate, maxTurns: 3 }) }
}

const S = "ses_1"
const succeeded = { type: "session.execution.succeeded", data: { sessionID: S } }
const command = (goals, text) => goals.command({ sessionID: S, prompt: { text, files: [] }, delivery: "steer" })
const contextFor = () => ({ sessionID: S, tools: { [TOOL]: {}, bash: {} }, messages: [{ role: "user", content: "hello" }] })

test("/goal <task> stores the goal and sends the task as a prompt", async () => {
  const { log, store, goals } = fakeHost()
  await command(goals, "write fizzbuzz")
  assert.equal(log.prompts.length, 1)
  assert.equal(log.prompts[0].text, "write fizzbuzz")
  assert.equal(log.prompts[0].sessionID, S)
  assert.equal(log.prompts[0].delivery, "steer")
  assert.deepEqual(log.prompts[0].files, [])
  assert.equal(store.get(`goal:${S}`).status, "active")
  assert.equal(log.metadata[S][STATE_KEY].objective, "write fizzbuzz")
  assert.match(log.metadata[S][NOTICE_KEY].message, /Goal set/)
})

test("the goal tool and reminder only appear while a goal is active", async () => {
  const { goals } = fakeHost()
  const idle = contextFor()
  await goals.onContext(idle)
  assert.equal(TOOL in idle.tools, false)
  assert.equal(idle.messages[0].content, "hello")
  await command(goals, "write fizzbuzz")
  const active = contextFor()
  await goals.onContext(active)
  assert.equal(TOOL in active.tools, true)
  assert.match(active.messages[0].content, /Goal: write fizzbuzz/)
})

test("a finished turn without a claim sends a continuation", async () => {
  const { log, goals } = fakeHost()
  await command(goals, "write fizzbuzz")
  await goals.onEvent(succeeded)
  assert.equal(log.synthetic.length, 1)
  assert.match(log.synthetic[0].text, /not achieved yet/)
  assert.equal(log.generated.length, 0)
  assert.equal((await goals.get(S)).turn, 1)
})

test("a claim is checked by the evaluator with the session model", async () => {
  const { log, goals } = fakeHost({ verdicts: ['{"done": false, "reason": "no tests ran"}', '{"done": true, "reason": "tests pass"}'] })
  await command(goals, "write fizzbuzz")
  assert.match((await goals.tool.execute({ status: "achieved", summary: "done" }, { sessionID: S })).content, /independent check/)
  await goals.onEvent(succeeded)
  assert.equal(log.generated.length, 1)
  assert.deepEqual(log.generated[0].model, { providerID: "local", id: "glm" })
  assert.match(log.generated[0].prompt, /write fizzbuzz/)
  assert.match(log.generated[0].prompt, /done, tests pass/)
  assert.match(log.synthetic.at(-1).text, /no tests ran/)
  await goals.tool.execute({ status: "achieved", summary: "now really done" }, { sessionID: S })
  await goals.onEvent(succeeded)
  const state = await goals.get(S)
  assert.equal(state.status, "done")
  assert.equal(log.synthetic.length, 1)
  assert.equal(log.metadata[S][NOTICE_KEY].variant, "success")
  const after = contextFor()
  await goals.onContext(after)
  assert.equal(TOOL in after.tools, false)
})

test("a failing evaluator pauses the goal", async () => {
  const { log, goals } = fakeHost({ failCheck: true })
  await command(goals, "x")
  await goals.tool.execute({ status: "achieved", summary: "done" }, { sessionID: S })
  await goals.onEvent(succeeded)
  assert.equal((await goals.get(S)).status, "paused")
  assert.equal(log.synthetic.length, 0)
  assert.equal(log.metadata[S][NOTICE_KEY].variant, "error")
})

test("the turn limit, interrupts and failures pause; resume continues", async () => {
  const { log, goals } = fakeHost()
  await command(goals, "x")
  for (let i = 0; i < 3; i++) await goals.onEvent(succeeded)
  assert.equal((await goals.get(S)).status, "paused")
  assert.equal(log.synthetic.length, 2)
  await command(goals, "resume")
  assert.equal((await goals.get(S)).status, "active")
  assert.equal(log.synthetic.length, 3)
  await goals.onEvent({ type: "session.execution.interrupted", data: { sessionID: S, reason: "superseded" } })
  assert.equal((await goals.get(S)).status, "active")
  await goals.onEvent({ type: "session.execution.interrupted", data: { sessionID: S, reason: "user" } })
  assert.match((await goals.get(S)).reason, /interrupted by the user/)
  await command(goals, "resume")
  await goals.onEvent({ type: "session.execution.failed", data: { sessionID: S, error: { message: "rate limited" } } })
  assert.match((await goals.get(S)).reason, /rate limited/)
})

test("a blocked claim pauses without asking the evaluator", async () => {
  const { log, goals } = fakeHost()
  await command(goals, "x")
  await goals.tool.execute({ status: "blocked", summary: "need credentials" }, { sessionID: S })
  await goals.onEvent(succeeded)
  assert.equal(log.generated.length, 0)
  assert.match((await goals.get(S)).reason, /need credentials/)
})

test("/goal stop clears the goal and keeps other metadata", async () => {
  const { log, store, goals } = fakeHost()
  log.metadata[S] = { other: 1 }
  await command(goals, "x")
  await command(goals, "stop")
  assert.equal(await goals.get(S), null)
  assert.equal(store.has(`goal:${S}`), false)
  assert.equal(STATE_KEY in log.metadata[S], false)
  assert.equal(log.metadata[S].other, 1)
  await goals.onEvent(succeeded)
  assert.equal(log.synthetic.length, 0)
})

test("/goal status reports through a notice without prompting", async () => {
  const { log, goals } = fakeHost()
  await command(goals, "")
  assert.match(log.metadata[S][NOTICE_KEY].message, /No goal/)
  await command(goals, "build it")
  await command(goals, "status")
  assert.match(log.metadata[S][NOTICE_KEY].message, /Goal: build it/)
  assert.equal(log.prompts.length, 1)
})

test("a stop during the check discards the verdict", async () => {
  const { log, goals } = fakeHost({ verdicts: ['{"done": true, "reason": "ok"}'] })
  await command(goals, "x")
  await goals.tool.execute({ status: "achieved", summary: "done" }, { sessionID: S })
  const pending = goals.onEvent(succeeded)
  await command(goals, "stop")
  await pending
  assert.equal(await goals.get(S), null)
  assert.equal(log.synthetic.length, 0)
})

test("remind appends to array content", () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "a" }] }, { role: "assistant", content: "b" }]
  remind(messages, "note")
  assert.deepEqual(messages[0].content.at(-1), { type: "text", text: "note" })
})
