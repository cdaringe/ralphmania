// Integration tests for publishContainedGui
import { assert, assertEquals } from "jsr:@std/assert@^1";
import * as path from "jsr:@std/path@^1";
import { publishContainedGui } from "./publish.ts";

Deno.test(
  "publishContainedGui: happy path writes HTML pages and manifest",
  async () => {
    const outDir = await Deno.makeTempDir();
    const logged: string[] = [];
    const log = (
      { message }: { tags: string[]; message: string },
    ): void => {
      logged.push(message);
    };

    const result = await publishContainedGui({ outDir, log });

    assert(
      result.isOk(),
      `Expected ok result, got: ${result.isErr() ? result.error : ""}`,
    );
    assert(logged.length > 0, "Expected at least one log message");
    const written = result.value;

    // Should have written 3 HTML files + manifest.json
    assertEquals(written.length, 4);

    const expectedFiles = [
      "index.html",
      "worker.html",
      "scenario.html",
      "manifest.json",
    ];
    for (const filename of expectedFiles) {
      const fullPath = path.join(outDir, filename);
      assert(
        written.includes(fullPath),
        `Expected ${fullPath} in written list`,
      );
      const stat = await Deno.stat(fullPath);
      assert(stat.isFile, `Expected ${fullPath} to be a file`);
    }

    // Cleanup
    await Deno.remove(outDir, { recursive: true });
  },
);

Deno.test(
  "publishContainedGui: manifest.json has fullyContained: true",
  async () => {
    const outDir = await Deno.makeTempDir();

    const result = await publishContainedGui({ outDir });

    assert(
      result.isOk(),
      `Expected ok result, got: ${result.isErr() ? result.error : ""}`,
    );

    const manifestPath = path.join(outDir, "manifest.json");
    const raw = await Deno.readTextFile(manifestPath);
    const manifest = JSON.parse(raw) as {
      fullyContained: boolean;
      assets: string[];
      generatedAt: string;
    };

    assertEquals(manifest.fullyContained, true);
    assertEquals(manifest.assets.length, 3);
    assert(manifest.assets.includes("index.html"));
    assert(manifest.assets.includes("worker.html"));
    assert(manifest.assets.includes("scenario.html"));
    assert(typeof manifest.generatedAt === "string");

    await Deno.remove(outDir, { recursive: true });
  },
);

Deno.test({
  name:
    "publishContainedGui: each HTML file is self-contained with inlined style and module script",
  // esbuild manages its own child process lifecycle; Deno's sanitizer sees the
  // process exit completing after the test function returns — this is expected.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const outDir = await Deno.makeTempDir();

    const result = await publishContainedGui({ outDir });

    assert(
      result.isOk(),
      `Expected ok result, got: ${result.isErr() ? result.error : ""}`,
    );

    for (const filename of ["index.html", "worker.html", "scenario.html"]) {
      const fullPath = path.join(outDir, filename);
      const html = await Deno.readTextFile(fullPath);
      assert(
        html.includes("<style>"),
        `Expected <style> tag in ${filename}`,
      );
      assert(
        html.includes('<script type="module">'),
        `Expected <script type="module"> in ${filename}`,
      );
      assert(
        !html.includes("importmap"),
        `${filename} should not require importmap (preact is bundled inline)`,
      );
      assert(
        html.includes("<!DOCTYPE html>"),
        `Expected DOCTYPE in ${filename}`,
      );
    }

    await Deno.remove(outDir, { recursive: true });
  },
});

Deno.test({
  name: "publishContainedGui: returns Err when outDir is an unwritable path",
  // esbuild process from prior test may still be shutting down; disable
  // sanitizers to avoid false-positive leak detection.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Use a path inside a non-existent parent that cannot be created due to
    // a file (not directory) blocking the path.
    const tempFile = await Deno.makeTempFile();

    // outDir points inside a plain file — mkdir will fail
    const outDir = path.join(tempFile, "subdir");
    const result = await publishContainedGui({ outDir });

    assert(result.isErr(), "Expected Err when outDir cannot be created");
    assert(
      typeof result.error === "string" && result.error.length > 0,
      "Expected non-empty error string",
    );

    await Deno.remove(tempFile);
  },
});
