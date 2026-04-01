import { assert, assertEquals } from "jsr:@std/assert@^1";
import * as path from "jsr:@std/path@^1";
import { publishContainedGui } from "../src/gui/publish.ts";

Deno.test("publishContainedGui writes compiled, fully-contained GUI pages", async () => {
  const outDir = await Deno.makeTempDir({ prefix: "gui-publish-" });
  try {
    const result = await publishContainedGui({ outDir });
    assert(result.isOk(), result.isErr() ? result.error : "expected ok result");

    const files = [
      "index.html",
      "worker.html",
      "scenario.html",
      "manifest.json",
    ];
    for (const file of files) {
      const stat = await Deno.stat(path.join(outDir, file));
      assertEquals(stat.isFile, true);
    }

    for (const page of ["index.html", "worker.html", "scenario.html"]) {
      const html = await Deno.readTextFile(path.join(outDir, page));
      assert(html.includes("<style>"), `${page} missing inline style`);
      assert(
        html.includes('<script type="module">'),
        `${page} missing inline JS`,
      );
      assert(html.includes('id="app-root"'), `${page} missing app root`);
      assert(
        !/<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//.test(html),
        `${page} should not include external script/link URLs`,
      );
      assert(
        !html.includes("importmap"),
        `${page} should not require importmap`,
      );
    }

    const manifest = JSON.parse(
      await Deno.readTextFile(path.join(outDir, "manifest.json")),
    ) as { assets: string[]; fullyContained: boolean };
    assertEquals(manifest.fullyContained, true);
    assertEquals(manifest.assets.includes("index.html"), true);
    assertEquals(manifest.assets.includes("worker.html"), true);
    assertEquals(manifest.assets.includes("scenario.html"), true);
  } finally {
    await Deno.remove(outDir, { recursive: true }).catch(() => {});
  }
});
