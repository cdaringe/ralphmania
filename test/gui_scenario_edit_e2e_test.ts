import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.11";
import { startGuiServer } from "../src/gui/server.tsx";
import { updateProgressRow } from "../src/parsers/progress-update.ts";
import { parseProgressRows } from "../src/parsers/progress-rows.ts";

const PROGRESS_TEMPLATE = `# Progress

| #     | Status | Summary                           | Rework Notes |
| ----- | ------ | --------------------------------- | ------------ |
| GUI.e |        | Scenario edit tasks from the GUI. |              |
`;

const PROGRESS_WITH_REWORK = `# Progress

| #     | Status        | Summary                           | Rework Notes |
| ----- | ------------- | --------------------------------- | ------------ |
| GUI.e | NEEDS_REWORK  | Scenario edit tasks from the GUI. | fix inputs   |
`;

const makeProgressFile = async (
  content = PROGRESS_TEMPLATE,
): Promise<string> => {
  const file = await Deno.makeTempFile();
  await Deno.writeTextFile(file, content);
  return file;
};

const makeUpdater = (progressFile: string) =>
async (
  update: { scenarioId: string; status: string; reworkNotes: string },
) => {
  const raw = await Deno.readTextFile(progressFile);
  const result = updateProgressRow(raw, update);
  if (!result.isOk()) return { ok: false as const, error: result.error };
  await Deno.writeTextFile(progressFile, result.value);
  return { ok: true as const };
};

const startServer = async (progressFile: string) => {
  const controller = new AbortController();
  const handle = await startGuiServer({
    port: 0,
    signal: controller.signal,
    skipBuild: true,
    progressRowUpdater: makeUpdater(progressFile),
  });
  return { controller, handle };
};

Deno.test("PATCH /api/scenario marks NEEDS_REWORK with notes", async () => {
  const progressFile = await makeProgressFile();
  const { controller, handle } = await startServer(progressFile);

  const res = await fetch(
    `http://localhost:${handle.port}/api/scenario/GUI.e`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "needs_rework",
        reworkNotes: "browser actions broken",
      }),
    },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  const updated = await Deno.readTextFile(progressFile);
  assertStringIncludes(updated, "NEEDS_REWORK");
  assertStringIncludes(updated, "browser actions broken");

  controller.abort();
  await handle.finished.catch((): void => {});
});

Deno.test("PATCH /api/scenario enforces notes for NEEDS_REWORK", async () => {
  const progressFile = await makeProgressFile();
  const { controller, handle } = await startServer(progressFile);

  const res = await fetch(
    `http://localhost:${handle.port}/api/scenario/GUI.e`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "NEEDS_REWORK" }),
    },
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "reworkNotes required for NEEDS_REWORK");

  controller.abort();
  await handle.finished.catch((): void => {});
});

Deno.test("PATCH /api/scenario can mark a scenario OBSOLETE and clears notes", async () => {
  const progressFile = await makeProgressFile(PROGRESS_WITH_REWORK);
  const { controller, handle } = await startServer(progressFile);

  const res = await fetch(
    `http://localhost:${handle.port}/api/scenario/GUI.e`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "OBSOLETE" }),
    },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);

  const parsed = parseProgressRows(await Deno.readTextFile(progressFile));
  assert(parsed.isOk());
  const row = parsed.value.find((r) => r.scenario === "GUI.e");
  assert(row);
  assertEquals(row.status, "OBSOLETE");
  assertEquals(row.reworkNotes, "");

  controller.abort();
  await handle.finished.catch((): void => {});
});

Deno.test("PATCH /api/scenario rejects invalid statuses", async () => {
  const progressFile = await makeProgressFile();
  const { controller, handle } = await startServer(progressFile);

  const res = await fetch(
    `http://localhost:${handle.port}/api/scenario/GUI.e`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "IN_REVIEW" }),
    },
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "invalid status");

  controller.abort();
  await handle.finished.catch((): void => {});
});
