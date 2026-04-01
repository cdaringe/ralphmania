# GUI.d — Send Text Input to Active Agent

## Scenario

> The GUI SHALL support sending text INPUT into any active agent.

## How It Is Achieved

### Domain module — `src/gui/input-bus.ts`

`AgentInputBus` is a pure-domain registry mapping worker indices to
`WritableStreamDefaultWriter<Uint8Array>` handles. Key API:

- **`register(workerIndex, stdin)`** — called when an agent subprocess starts
  with `stdin: "piped"`. Acquires the writer via `stdin.getWriter()`.
- **`unregister(workerIndex)`** — called when the subprocess exits. Releases the
  writer lock and removes the entry.
- **`send(workerIndex, text)`** — writes UTF-8 encoded text to the registered
  worker's stdin. Returns `true` on success, `false` if no worker is registered
  or the write fails (e.g. broken pipe after process exit).

### Backend support

Interactive GUI input is currently supported for Claude workers only.
`executeAgent` uses the Claude SDK session API to queue follow-up user messages
mid-run.

Codex workers continue to run as one-shot subprocesses with `stdin: "null"`.
This avoids a startup hang where current `codex exec` builds wait on an open
stdin pipe and print `Reading additional input from stdin...`.

### HTTP endpoint — `POST /input/:workerId`

`startGuiServer` now accepts optional `agentInputBus`. An async handler
intercepts `POST /input/:workerId` requests:

```
POST /input/0
Content-Type: text/plain
Body: "please clarify the requirement for scenario GUI.d"
```

The text body is read, `"\n"` is appended, and
`agentInputBus.send(workerIndex,
text)` is called. Returns `200 ok` on success,
`404 no active worker` if the worker is not registered, `503` if no input bus is
configured.

### GUI — worker page input form

`WORKER_PAGE_HTML` (in `src/gui/html.ts`) now includes an `#input-bar` section
at the bottom of the log panel containing:

- A `<textarea>` (Enter to send, Shift+Enter for newline).
- A **Send** button.
- A `#send-status` span showing transient feedback ("sending…", "sent", "no
  active worker", "error").

The form elements are **disabled** by default and enabled only when the worker
state transitions to `running` (via `worker_active` SSE event or SSE reconnect).
They are disabled again when the worker reaches `done` or `failed` state.

### Wiring — `mod.ts`

`createAgentInputBus()` is instantiated alongside `createEventBus()` whenever
`--gui` is active. It is passed to both:

- `startGuiServer({ ..., agentInputBus })` — for HTTP input routing.
- `runParallelLoop({ ..., agentInputBus })` — propagated via closure in
  `orchestrator.ts` to every `runIterationImpl` call.

When `--gui` is not active, `agentInputBus` is `undefined` and all behavior is
identical to before.

## Evidence

| Artifact                              | Detail                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| `src/gui/input-bus.ts`                | Domain registry; 100% line + branch coverage                   |
| `src/gui/input-bus.test.ts`           | 6 unit tests covering all paths                                |
| `src/gui/server.ts:34-44`             | POST `/input/:workerId` handler                                |
| `src/gui/server.test.ts`              | 3 integration tests: 200/404/503 paths via real HTTP           |
| `src/gui/html.ts`                     | `#input-bar` textarea + send button in WORKER_PAGE_HTML        |
| `src/machines/worker-machine.test.ts` | `transitionRunningAgent: passes agentInputBus to deps.execute` |
| `src/runner.ts`                       | Claude session input enabled; Codex subprocess stdin disabled  |
| `src/orchestrator.ts:90`              | `agentInputBus` closed over in `runIteration` dep              |
| `mod.ts:151-159`                      | `createAgentInputBus()` wired on `--gui` startup               |
