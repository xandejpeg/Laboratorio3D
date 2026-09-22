/** Bridge protocol tests only: no HTTP, pipeline, model or browser process. */
import { describe, expect, test } from "bun:test";
import { bridgeForm, createBridgeReceiver, type BridgePeer, type ImportReceipt } from "../web/bridge.ts";
import { bridgeOrigins, LOCAL_2D_ORIGINS } from "../src/bridge-origins.ts";
import { syntheticBundlePayload, syntheticPng } from "./fixtures.ts";

const ORIGIN = "http://127.0.0.1:8766";
const ID = "request_12345678";
const MiB = 1024 * 1024;
const receipt: ImportReceipt = { key: "a".repeat(64), reused: false, url: "http://127.0.0.1:8770/?character=" + "a".repeat(64) };
const sheet = () => syntheticBundlePayload({ front: { width: 2, height: 3 } });
const png = () => new Blob([new Uint8Array(syntheticPng(2, 3))], { type: "image/png" });
const images = () => [{ angle: "front", blob: png() }];
const hello = (requestId = ID) => ({ type: "lab3d:hello", version: 1, requestId });
const transfer = (requestId = ID) => ({ type: "lab3d:import", version: 1, requestId, sheet: sheet(), images: images() });

function harness(importer: (form: FormData) => Promise<ImportReceipt> = async () => receipt) {
  let timestamp = 1000;
  const replies: { message: any; targetOrigin: string }[] = [];
  const statuses: { message: string; kind: string }[] = [];
  const submissions: FormData[] = [];
  const opener: BridgePeer = { postMessage: (message, targetOrigin) => { replies.push({ message, targetOrigin }); } };
  const receive = createBridgeReceiver({
    opener, allowedOrigins: [ORIGIN], now: () => timestamp,
    importForm: async (form) => { submissions.push(form); return importer(form); },
    onStatus: (message, kind) => { statuses.push({ message, kind }); },
  });
  return {
    opener, replies, statuses, submissions,
    advance: (milliseconds: number) => { timestamp += milliseconds; },
    send: (data: unknown, source: unknown = opener, origin = ORIGIN) => receive({ data, source, origin }),
  };
}

function deferredReceipt() {
  let resolve!: (value: ImportReceipt) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ImportReceipt>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("bridge multipart validation", () => {
  test("preserves the native JSON, binary reference and labelled note", async () => {
    const payload = sheet();
    const image = png();
    const form = bridgeForm(payload, [{ angle: "front", blob: image }, { angle: "back", blob: image, note: "Referência adicional" }]);
    const json = form.get("sheet") as File;
    expect(json.type.split(";")[0]).toBe("application/json");
    expect(JSON.parse(await json.text())).toEqual(payload);
    const front = form.get("front") as File;
    expect(front.name).toBe("front.png");
    expect(front.type).toBe("image/png");
    expect(new Uint8Array(await front.arrayBuffer())).toEqual(new Uint8Array(await image.arrayBuffer()));
    expect(form.get("note:back")).toBe("Referência adicional");
  });

  test("requires a serializable object with the exact native contract/version", () => {
    for (const payload of [null, [], "{}", 123, {}, { contract: "other", contractVersion: 1 }, { contract: "lab3d.character-import", contractVersion: "1" }]) {
      expect(() => bridgeForm(payload, images())).toThrow();
    }
    const circular = sheet();
    circular["cycle"] = circular;
    expect(() => bridgeForm(circular, images())).toThrow();
    expect(() => bridgeForm({ ...sheet(), unsupported: 1n }, images())).toThrow();
  });

  test("requires the front and refuses duplicate, unknown and excessive angles", () => {
    for (const references of [null, {}, [], [{ angle: "back", blob: png() }], [{ angle: "diagonal", blob: png() }], [...images(), ...images()], Array.from({ length: 7 }, () => images()[0])]) {
      expect(() => bridgeForm(sheet(), references)).toThrow();
    }
  });

  test("rejects malformed blobs and invalid or excessive notes", () => {
    for (const reference of [null, "front", { angle: "front", blob: {} }, { angle: "front", blob: new Blob([], { type: "image/png" }) }, { angle: "front", blob: new Blob(["text"], { type: "text/plain" }) }, { angle: "front", blob: new Blob(["text"], { type: "constructor" }) }, { angle: "front", blob: new Blob(["text"], { type: "__proto__" }) }, { angle: "front", blob: png(), note: 12 }, { angle: "front", blob: png(), note: "n".repeat(2001) }]) {
      expect(() => bridgeForm(sheet(), [reference])).toThrow();
    }
    expect(() => bridgeForm(sheet(), [{ angle: "front", blob: png(), note: "n".repeat(2000) }])).not.toThrow();
  });

  test("enforces sheet, per-image and aggregate size limits before submission", () => {
    expect(() => bridgeForm({ ...sheet(), extra: "x".repeat(2 * MiB) }, images())).toThrow("2 MiB");
    const tooLarge = new Blob([new Uint8Array(24 * MiB + 1)], { type: "image/png" });
    expect(() => bridgeForm(sheet(), [{ angle: "front", blob: tooLarge }])).toThrow("24 MiB");
    const maximum = new Blob([new Uint8Array(24 * MiB)], { type: "image/png" });
    expect(() => bridgeForm(sheet(), [{ angle: "front", blob: maximum }])).not.toThrow();
    expect(() => bridgeForm(sheet(), ["front", "back", "profile-left", "profile-right"].map((angle) => ({ angle, blob: maximum })))).toThrow("limite de envio");
  });
});

describe("bridge handshake and replay protection", () => {
  test("wrong origin/source cannot establish a session or trigger an import", async () => {
    const h = harness();
    const impostor: BridgePeer = { postMessage() {} };
    await h.send(hello(), impostor);
    await h.send(hello(), h.opener, "https://unrelated.example");
    await h.send(transfer());
    expect(h.submissions).toHaveLength(0);
    expect(h.replies).toHaveLength(0);
    await h.send(hello());
    await h.send(transfer(), impostor);
    await h.send(transfer(), h.opener, "https://unrelated.example");
    expect(h.submissions).toHaveLength(0);
    expect(h.replies).toHaveLength(1);
  });

  test("without an opener the receiver never answers or imports", async () => {
    let calls = 0;
    const receive = createBridgeReceiver({ opener: null, allowedOrigins: [ORIGIN], importForm: async () => { calls++; return receipt; }, onStatus() {} });
    await receive({ source: null, origin: ORIGIN, data: hello() });
    await receive({ source: null, origin: ORIGIN, data: transfer() });
    expect(calls).toBe(0);
  });

  test("requires hello and rejects mismatched ids, versions and malformed envelopes", async () => {
    const h = harness();
    await h.send(transfer());
    expect(h.submissions).toHaveLength(0);
    await h.send(hello());
    for (const data of [null, [], "import", { ...transfer(), type: "other" }, transfer("another_request"), { ...transfer(), version: "1" }, { ...transfer(), version: 2 }, transfer("short"), transfer("x".repeat(81)), transfer("request!bad"), { ...transfer(), requestId: 123 }]) {
      await h.send(data);
    }
    expect(h.submissions).toHaveLength(0);
    expect(h.replies[0]).toEqual({ message: { type: "lab3d:ready", version: 1, requestId: ID }, targetOrigin: ORIGIN });
    await h.send(transfer());
    expect(h.submissions).toHaveLength(1);
    expect(h.replies.at(-1)?.message).toMatchObject({ type: "lab3d:import-result", requestId: ID, ok: true, ...receipt });
    expect(h.statuses.map((status) => status.kind)).toEqual(["info", "ok"]);
  });

  test("inflight and completed replay submit exactly once and reuse the acknowledgement", async () => {
    const pending = deferredReceipt();
    const h = harness(() => pending.promise);
    await h.send(hello());
    const first = h.send(transfer());
    await h.send(transfer());
    await h.send(transfer());
    expect(h.submissions).toHaveLength(1);
    expect(h.replies).toHaveLength(1);
    pending.resolve({ ...receipt, reused: true });
    await first;
    const acknowledgement = h.replies.at(-1);
    expect(acknowledgement?.message).toMatchObject({ requestId: ID, ok: true, reused: true });
    await h.send(transfer());
    await h.send(hello());
    expect(h.submissions).toHaveLength(1);
    expect(h.replies.at(-1)).toEqual(acknowledgement);
    expect(h.statuses).toHaveLength(2);
  });

  test("a new hello id while inflight cannot change the destination or result id", async () => {
    const pending = deferredReceipt();
    const h = harness(() => pending.promise);
    await h.send(hello());
    const first = h.send(transfer());
    await h.send(hello("replacement_request"));
    await h.send(transfer("replacement_request"));
    expect(h.replies).toHaveLength(1);
    expect(h.submissions).toHaveLength(1);
    pending.resolve(receipt);
    await first;
    expect(h.replies.at(-1)).toEqual({
      message: { type: "lab3d:import-result", version: 1, requestId: ID, ok: true, ...receipt }, targetOrigin: ORIGIN,
    });
    await h.send(hello("replacement_request"));
    expect(h.replies).toHaveLength(2);
  });

  test("the handshake expires after 120 seconds without importing or renewing on hello", async () => {
    const h = harness();
    await h.send(hello());
    h.advance(120_001);
    await h.send(hello());
    await h.send(transfer());
    expect(h.submissions).toHaveLength(0);
    const acknowledgement = h.replies.at(-1);
    expect(acknowledgement?.message).toMatchObject({ requestId: ID, ok: false });
    expect(acknowledgement?.message.error).toContain("expirou");
    await h.send(transfer());
    expect(h.replies.at(-1)).toEqual(acknowledgement);
    expect(h.statuses.map((status) => status.kind)).toEqual(["error"]);
  });

  test("an import at the TTL boundary is accepted and does not expire while pending", async () => {
    const pending = deferredReceipt();
    const h = harness(() => pending.promise);
    await h.send(hello());
    h.advance(120_000);
    const first = h.send(transfer());
    h.advance(120_001);
    await h.send(transfer());
    pending.resolve(receipt);
    await first;
    expect(h.submissions).toHaveLength(1);
    expect(h.replies.at(-1)?.message.ok).toBe(true);
  });

  test("malformed payloads produce a stable negative acknowledgement without POST", async () => {
    const h = harness();
    await h.send(hello());
    await h.send({ ...transfer(), images: [{ angle: "front", blob: "not a Blob" }] });
    const acknowledgement = h.replies.at(-1);
    expect(acknowledgement?.message).toMatchObject({ type: "lab3d:import-result", requestId: ID, ok: false });
    expect(h.submissions).toHaveLength(0);
    await h.send(transfer());
    expect(h.submissions).toHaveLength(0);
    expect(h.replies.at(-1)).toEqual(acknowledgement);
  });

  test("a failed local import is acknowledged once and never automatically retried", async () => {
    const pending = deferredReceipt();
    const h = harness(() => pending.promise);
    await h.send(hello());
    const first = h.send(transfer());
    pending.reject(new Error("Synthetic local import rejection"));
    await first;
    await h.send(transfer());
    expect(h.submissions).toHaveLength(1);
    expect(h.replies.at(-1)?.message).toMatchObject({ requestId: ID, ok: false, error: "Synthetic local import rejection" });
    expect(h.statuses.map((status) => status.kind)).toEqual(["info", "error"]);
  });
});

describe("bridge allowed-origin parser", () => {
  test("keeps loopback defaults and accepts only exact additional HTTPS/loopback origins", () => {
    expect(bridgeOrigins()).toEqual([...LOCAL_2D_ORIGINS]);
    expect(bridgeOrigins(" https://generator.example, http://localhost:9000, http://[::1]:9001, https://generator.example ")).toEqual([
      ...LOCAL_2D_ORIGINS, "https://generator.example", "http://localhost:9000", "http://[::1]:9001",
    ]);
  });

  test("rejects wildcard, insecure remote, credentials, paths and noncanonical origins", () => {
    for (const value of ["*", "null", "not-a-url", "http://generator.example", "https://generator.example/", "https://generator.example/path", "https://generator.example?q=1", "https://generator.example#fragment", "https://user:password@generator.example", "file:///tmp/generator", "https://generator.example:443", "http://localhost.evil.example:8766"]) {
      expect(() => bridgeOrigins(value)).toThrow();
    }
    expect(() => bridgeOrigins("https://valid.example,http://invalid.example")).toThrow();
  });
});
