import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { assertStringIncludes } from "jsr:@std/assert@^1.0.11";

/**
 * Scenario 24: The receipts SHALL ensure all markdown is properly rendered.
 *
 * These tests verify that the generated HTML receipts use markdown-it
 * client-side rendering for ALL markdown content sections (requirement,
 * implementation, evidence) rather than naive text substitution.
 */

// We test the generated HTML output by importing and invoking the receipt
// generator's core function indirectly — since generate_receipts.ts is a
// standalone script, we test by reading its output or by asserting on the
// HTML template structure.

// Simpler approach: read the generator source and assert structural properties.

const generatorSource = await Deno.readTextFile("generate_receipts.ts");

Deno.test("receipt requirement section uses markdown-content class and id for rendering", () => {
  // The requirement div must have id="requirement" and class="markdown-content"
  // so the client-side markdown-it script renders it.
  assertStringIncludes(
    generatorSource,
    'id="requirement" class="requirement markdown-content"',
  );
});

Deno.test("receipt requirement section does NOT use naive br replacement", () => {
  // The old approach was: scenario.requirement.replace(/\\n/g, "<br>")
  // This should no longer exist in the template.
  assertEquals(
    generatorSource.includes('.replace(/\\n/g, "<br>")'),
    false,
    "requirement should not use naive newline-to-br replacement",
  );
});

Deno.test("receipt client-side script renders all three markdown sections", () => {
  // The script must call md.render on requirement, implementation, and evidence
  assertStringIncludes(generatorSource, "getElementById('requirement')");
  assertStringIncludes(generatorSource, "getElementById('implementation')");
  assertStringIncludes(generatorSource, "getElementById('evidence')");

  // All three must be rendered
  assertStringIncludes(generatorSource, "reqEl.innerHTML = md.render(");
  assertStringIncludes(generatorSource, "implEl.innerHTML = md.render(");
  assertStringIncludes(generatorSource, "evidenceEl.innerHTML = md.render(");
});

Deno.test("receipt markdown-it config enables html rendering", () => {
  // html: true ensures embedded HTML in markdown renders properly
  assertStringIncludes(generatorSource, "html: true");
});

Deno.test("receipt includes markdown-it and highlight.js CDN scripts", () => {
  assertStringIncludes(generatorSource, "markdown-it");
  assertStringIncludes(generatorSource, "highlight.js");
});
