import { describe, expect, test } from "bun:test";
import { Auth, createLLMClient, Endpoint, Framing } from "./route.ts";
import { OpenAIChat } from "./protocols/openai-chat.ts";

const encoder = new TextEncoder();

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function parse(...chunks: string[]) {
  return Array.fromAsync(Framing.sse.parse(byteStream(chunks.map((s) => encoder.encode(s)))));
}

describe("SSE framing", () => {
  test("preserves event and data when the blank separator arrives in a later chunk", async () => {
    expect(await parse("event: delta\n", "data: first\n", "data: second\n", "\n"))
      .toEqual([{ event: "delta", data: "first\nsecond" }]);
  });

  for (const eol of ["\n", "\r\n", "\r"]) {
    test(`is independent of every byte split with ${JSON.stringify(eol)} line endings`, async () => {
      const wire = [
        ": heartbeat", "event: delta", "data: ação 🌍", "data: second", "",
        "data: next", "", "",
      ].join(eol);
      const bytes = encoder.encode(wire);
      const expected = [
        { event: "delta", data: "ação 🌍\nsecond" },
        { event: "message", data: "next" },
      ];
      // Covers boundaries in field names, CRLF, UTF-8 code points and separators.
      for (let cut = 0; cut <= bytes.length; cut++) {
        expect(await Array.fromAsync(Framing.sse.parse(byteStream([
          bytes.slice(0, cut), bytes.slice(cut),
        ])))).toEqual(expected);
      }
      expect(await Array.fromAsync(Framing.sse.parse(byteStream(
        Array.from(bytes, (byte) => Uint8Array.of(byte)),
      )))).toEqual(expected);
    });
  }

  test("preserves whitespace and empty data lines, removing only one optional space", async () => {
    expect(await parse("data:  indented  \ndata:\ndata:\tend \n\n"))
      .toEqual([{ event: "message", data: " indented  \n\n\tend " }]);
  });

  test("emits explicitly empty data but not comment-only or event-only blocks", async () => {
    expect(await parse(": comment\n\nevent: unused\n\ndata:\n\ndata\n\n"))
      .toEqual([{ event: "message", data: "" }, { event: "message", data: "" }]);
  });

  test("ignores other fields and resets event type after each block", async () => {
    expect(await parse(
      "id: 42\nretry: 1000\nunknown: ignored\nevent: custom\ndata: one\n\n",
      "event:\ndata: two\n\ndata: three\n\n",
    )).toEqual([
      { event: "custom", data: "one" },
      { event: "message", data: "two" },
      { event: "message", data: "three" },
    ]);
  });

  for (const ending of ["", "\n", "\r", "\r\n"]) {
    test(`flushes pending data at clean EOF with ${JSON.stringify(ending)} ending`, async () => {
      expect(await parse("event: final\ndata: ", `done${ending}`))
        .toEqual([{ event: "final", data: "done" }]);
    });
  }

  test("does not duplicate a fully terminated event at EOF", async () => {
    expect(await parse("data: one\n\n", "\n: tail"))
      .toEqual([{ event: "message", data: "one" }]);
  });

  test("flushes the decoder at EOF and accepts an initial UTF-8 BOM", async () => {
    const bytes = new Uint8Array([...encoder.encode("\uFEFFdata: x"), 0xe2, 0x82]);
    expect(await Array.fromAsync(Framing.sse.parse(byteStream([bytes]))))
      .toEqual([{ event: "message", data: "x\uFFFD" }]);
  });

  test("propagates stream failure without flushing an incomplete event and releases its lock", async () => {
    const failure = new Error("synthetic stream failure");
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(encoder.encode("data: incomplete\n"));
        else controller.error(failure);
      },
    });
    const seen: unknown[] = [];
    const consume = async () => {
      for await (const event of Framing.sse.parse(body)) seen.push(event);
    };
    await expect(consume()).rejects.toBe(failure);
    expect(seen).toEqual([]);
    expect(body.locked).toBe(false);
  });

  test("releases the reader when a consumer stops early", async () => {
    const body = byteStream([encoder.encode("data: one\n\ndata: two\n\n")]);
    for await (const event of Framing.sse.parse(body)) {
      expect(event.data).toBe("one");
      break;
    }
    expect(body.locked).toBe(false);
  });

  test("accepts null and empty streams", async () => {
    expect(await Array.fromAsync(Framing.sse.parse(null))).toEqual([]);
    expect(await parse()).toEqual([]);
  });

  test("delivers chunked OpenAI text and an EOF finish through the client without network", async () => {
    const wire = [
      'data: {"choices":[{"delta":{"content":"Olá 🌍"},"finish_reason":null}]}\r\n\r\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
    ].join("");
    let requests = 0;
    const mockFetch: typeof fetch = Object.assign(async () => {
      requests++;
      return new Response(byteStream(Array.from(encoder.encode(wire), (byte) => Uint8Array.of(byte))));
    }, { preconnect() {} });
    const client = createLLMClient({ fetch: mockFetch, maxAttempts: 1 });
    const events = await client.generate({
      id: "sse-test", protocol: OpenAIChat,
      endpoint: Endpoint.path("/chat/completions"), auth: Auth.passthrough,
      framing: Framing.sse, baseUrl: "https://unused.invalid",
    }, { model: { providerId: "openai", modelId: "test" }, messages: [] });
    expect(requests).toBe(1);
    expect(events).toContainEqual({ kind: "text-delta", text: "Olá 🌍" });
    expect(events).toContainEqual({
      kind: "message-finish", reason: "stop", usage: { input: 3, output: 2 },
    });
    expect(events.some((event) => event.kind === "error")).toBe(false);
  });
});
