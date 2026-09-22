import { describe, expect, test } from "bun:test";
import { probeLlm } from "../src/runtime.ts";
import { blenderCandidates, openscadCandidates } from "../../src/runtime/binaries.ts";
import { stopProcessTree } from "../../src/runtime/process.ts";

describe("runtime diagnostics without provider calls", () => {
  test("a Gemini key cannot enable the default OpenAI model", () => {
    expect(probeLlm({ GEMINI_API_KEY: "synthetic-test-key" }).configured).toBe(false);
  });
  test("explicit provider wins and selects its credential and endpoint", () => {
    const result = probeLlm({ PROCEDURA_MODEL: "gemini:fixture-model", GEMINI_API_KEY: "synthetic-test-key",
      GEMINI_BASE_URL: "https://user:secret@example.test/v1?token=private#fragment" });
    expect(result.configured).toBe(true);
    expect(result.provider).toBe("gemini");
    expect(result.baseUrl).toBe("https://example.test/v1");
    expect(JSON.stringify(result)).not.toContain("synthetic-test-key");
  });
  test("catalog model provider takes precedence over fallback provider", () => {
    const result = probeLlm({ PROCEDURA_PROVIDER: "gemini", PROCEDURA_MODEL: "gpt-5.2", GEMINI_API_KEY: "synthetic-test-key" });
    expect(result.provider).toBe("openai");
    expect(result.configured).toBe(false);
  });
  test("native installation sorting cannot displace explicit paths", () => {
    expect(blenderCandidates({ PROCEDURA_BLENDER_PATH: "fixture/custom/blender" })[0]).toBe("fixture/custom/blender");
    expect(openscadCandidates({ OPENSCAD_PATH: "fixture/custom/openscad" })[0]).toBe("fixture/custom/openscad");
  });
  test("cancellation terminates the worker and its child", async () => {
    const worker = Bun.spawn([process.execPath, "-e",
      'const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" }); console.log(child.pid); setInterval(() => {}, 1000);',
    ], { stdout: "pipe", stderr: "ignore" });
    let childPid = 0;
    try {
      const reader = worker.stdout.getReader();
      const line = await reader.read();
      reader.releaseLock();
      childPid = Number(new TextDecoder().decode(line.value).trim());
      expect(childPid).toBeGreaterThan(0);
      stopProcessTree(worker.pid);
      await worker.exited;
      let childAlive = true;
      try { process.kill(childPid, 0); } catch { childAlive = false; }
      expect(childAlive).toBe(false);
    } finally {
      stopProcessTree(worker.pid);
      if (childPid) stopProcessTree(childPid);
    }
  }, 15_000);
});
