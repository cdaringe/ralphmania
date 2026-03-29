import puppeteer from "npm:puppeteer-core@23";
import { startGuiServer } from "../src/gui/server.tsx";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import { initLogDir } from "../src/gui/log-dir.ts";

const CHROME = `${Deno.env.get("HOME")}/.cache/puppeteer/chrome/linux-147.0.7727.24/chrome-linux64/chrome`;

await initLogDir();
const ac = new AbortController();
startGuiServer({ port: 19989, signal: ac.signal, agentInputBus: createAgentInputBus() });
await new Promise(r => setTimeout(r, 10000));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("console", (msg: { type: () => string; text: () => string }) => console.log(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err: { message: string }) => console.log(`[PAGE_ERROR] ${err.message}`));
page.on("requestfailed", (req: { url: () => string; failure: () => { errorText: string } | null }) => console.log(`[FAILED] ${req.url()} - ${req.failure()?.errorText}`));

await page.goto("http://localhost:19989/", { waitUntil: "load" });
await new Promise(r => setTimeout(r, 10000));

const checks = await page.evaluate(() => ({
  reactFlow: !!document.querySelector(".react-flow"),
  graphRoot: document.getElementById("graph-root")?.innerHTML.substring(0, 200) ?? "MISSING",
  scriptCount: document.querySelectorAll("script").length,
  scriptSrcs: Array.from(document.querySelectorAll("script[src]")).map(s => (s as HTMLScriptElement).src),
  freshMarkers: document.body.innerHTML.includes("frsh:island"),
}));
console.log("\n=== CHECKS ===");
console.log(JSON.stringify(checks, null, 2));

await page.close();
await browser.close();
ac.abort();
