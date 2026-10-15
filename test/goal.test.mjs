import assert from "node:assert/strict"
import { test } from "node:test"
import { TOOL, afterTurn, claim, continuation, parseCommand, parseVerdict, pause, reminder, renderTranscript, resume, start, statusText } from "../plugin/goal.js"

test("parseCommand maps the arguments to actions", () => {
  assert.deepEqual(parseCommand(""), { action: "status" })
  assert.deepEqual(parseCommand("  status "), { action: "status" })
  assert.deepEqual(parseCommand("STOP"), { action: "stop" })
  assert.deepEqual(parseCommand("clear"), { action: "stop" })
  assert.deepEqual(parseCommand("resume"), { action: "resume" })
  assert.deepEqual(parseCommand("make the tests pass"), { action: "start", objective: "make the tests pass" })
  assert.deepEqual(parseCommand("/goal  write a parser\nwith tests"), { action: "start", objective: "write a parser\nwith tests" })
  assert.deepEqual(parseCommand("stop the server from crashing"), { action: "start", objective: "stop the server from crashing" })
})

test("a turn without a claim continues", () => {
  const { state, next } = afterTurn(start("x", { maxTurns: 5 }))
  assert.equal(next, "continue")
  assert.equal(state.turn, 1)
  assert.equal(state.status, "active")
})

test("a confirmed claim finishes the goal", () => {
  const claimed = claim(start("x"), { status: "achieved", summary: "done" })
  const { state, next } = afterTurn(claimed, { done: true, reason: "tests pass" })
  assert.equal(next, "stop")
  assert.equal(state.status, "done")
  assert.equal(state.reason, "tests pass")
  assert.ok(state.finished)
})

test("a rejected claim continues with the feedback", () => {
  const claimed = claim(start("x"), { status: "achieved", summary: "done" })
  const { state, next } = afterTurn(claimed, { done: false, reason: "the tests were never run" })
  assert.equal(next, "continue")
  assert.equal(state.claim, null)
  assert.equal(state.feedback, "the tests were never run")
  assert.match(continuation(state), /the tests were never run/)
  assert.match(reminder(state), /rejected your claim: the tests were never run/)
})

test("a blocked claim pauses without a check", () => {
  const claimed = claim(start("x"), { status: "blocked", summary: "need the API key" })
  const { state, next } = afterTurn(claimed)
  assert.equal(next, "stop")
  assert.equal(state.status, "paused")
  assert.match(state.reason, /need the API key/)
})

test("the turn limit pauses the goal and resume extends it", () => {
  let state = start("x", { maxTurns: 2 })
  state = afterTurn(state).state
  const last = afterTurn(state)
  assert.equal(last.next, "stop")
  assert.equal(last.state.status, "paused")
  assert.match(last.state.reason, /limit of 2 turns/)
  const resumed = resume(last.state)
  assert.equal(resumed.status, "active")
  assert.equal(resumed.maxTurns, 4)
  assert.equal(resume(pause(start("x", { maxTurns: 9 }), "user")).maxTurns, 9)
})

test("reminder and status text describe the goal", () => {
  const state = start("ship it", { maxTurns: 7 })
  assert.match(reminder(state), /turn 1 of at most 7/)
  assert.match(reminder(state), new RegExp(TOOL))
  assert.match(statusText(state), /Goal: ship it/)
  assert.match(statusText(undefined), /No goal/)
})

test("parseVerdict reads JSON, skips thinking and falls back to not done", () => {
  assert.deepEqual(parseVerdict('{"done": true, "reason": "all green"}'), { done: true, reason: "all green" })
  assert.deepEqual(parseVerdict('<think>{"done": true}</think>\nSure: {"done": false, "reason": "lint fails"}'), { done: false, reason: "lint fails" })
  assert.equal(parseVerdict("```json\n{\"done\": true, \"reason\": \"ok\"}\n```").done, true)
  assert.equal(parseVerdict('"done": true, "reason": "half {broken').done, true)
  assert.equal(parseVerdict("I think it is fine").done, false)
  assert.equal(parseVerdict("").done, false)
})

test("renderTranscript keeps the newest messages within the limit", () => {
  const messages = [
    { type: "user", text: "old request" },
    { type: "assistant", content: [{ type: "reasoning", text: "hidden" }, { type: "text", text: "working" }, { type: "tool", name: "bash", state: { status: "completed", input: { command: "npm test" }, content: [{ type: "text", text: "3 passing" }] } }] },
    { type: "synthetic", text: "keep going" },
    { type: "assistant", content: [{ type: "tool", name: "edit", state: { status: "error", input: {}, error: { message: "no match" } } }] },
  ]
  const full = renderTranscript(messages)
  assert.match(full, /User: old request/)
  assert.match(full, /Tool bash\(\{"command":"npm test"\}\) → completed: 3 passing/)
  assert.match(full, /Tool edit\(\{\}\) → error: no match/)
  assert.doesNotMatch(full, /hidden/)
  const short = renderTranscript(messages, 60)
  assert.doesNotMatch(short, /old request/)
  assert.match(short, /edit/)
})
