import test from "node:test";
import assert from "node:assert/strict";
import { loadPreamble, mergeSystem, mapModel, buildUpstreamBody, toAnthropicParts, createOpenAiStreamer } from "../src/transform.js";

const preamble = [
  { type: "text", text: "You are ZCode, an interactive coding agent" },
  { type: "text", text: "block two" },
  { type: "text", text: "block three" },
];
const models = { "glm-5.3-flash": "GLM-5.3-Flash", "glm-5.3": "GLM-5.3" };
const ctx = { preamble, models, effort: "high", deviceMid: "dev-1", sessionId: "sess_1" };

test("system stays exactly three blocks, caller text is appended to the last one", () => {
  const merged = mergeSystem(preamble, [{ type: "text", text: "caller rules" }]);
  assert.equal(merged.length, 3);
  assert.match(merged[2].text, /caller rules$/);
  assert.equal(merged[2].text.startsWith("block three"), true);
});

test("mergeSystem does not mutate the preamble", () => {
  mergeSystem(preamble, [{ type: "text", text: "x" }]);
  assert.equal(preamble[2].text, "block three");
});

test("mergeSystem falls back when no preamble is configured", () => {
  assert.deepEqual(mergeSystem([], [{ type: "text", text: "a" }]), [{ type: "text", text: "a" }]);
});

test("model ids map onto the capitalized upstream ids", () => {
  assert.equal(mapModel("zcode", models), "GLM-5.3-Flash");
  assert.equal(mapModel("glm-5.3-flash", models), "GLM-5.3-Flash");
  assert.equal(mapModel("zcode-5.3", models), "GLM-5.3");
  assert.equal(mapModel("GLM-5.3", models), "GLM-5.3");
  assert.equal(mapModel("weird-model", models), "weird-model");
});

test("openai roles convert to anthropic blocks", () => {
  const body = buildUpstreamBody(
    {
      model: "zcode",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "calling", tool_calls: [{ id: "t1", function: { name: "run", arguments: '{"a":1}' } }] },
        { role: "tool", tool_call_id: "t1", content: "ok" },
      ],
      tools: [{ type: "function", function: { name: "run", description: "d", parameters: { type: "object", properties: { a: { type: "number" } } } } }],
      tool_choice: "required",
    },
    ctx,
  );
  assert.equal(body.system.length, 3);
  assert.match(body.system[2].text, /sys$/);
  assert.deepEqual(body.messages[0], { role: "user", content: [{ type: "text", text: "hi" }] });
  assert.deepEqual(body.messages[1].content[1], { type: "tool_use", id: "t1", name: "run", input: { a: 1 } });
  assert.equal(body.messages[2].content[0].type, "tool_result");
  assert.equal(body.messages[2].content[0].tool_use_id, "t1");
  assert.equal(body.tools[0].input_schema.properties.a.type, "number");
  assert.deepEqual(body.tool_choice, { type: "any" });
  assert.equal(body.stream, true);
  assert.equal(body.model, "GLM-5.3-Flash");
  assert.equal(JSON.parse(body.metadata.user_id).device_id, "dev-1");
});

test("consecutive tool results fold into one user turn", () => {
  const body = buildUpstreamBody(
    {
      model: "zcode",
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [{ id: "a", function: { name: "x", arguments: "{}" } }, { id: "b", function: { name: "y", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "a", content: "1" },
        { role: "tool", tool_call_id: "b", content: "2" },
      ],
    },
    ctx,
  );
  assert.equal(body.messages.at(-1).content.length, 2);
});

test("images become base64 anthropic blocks", () => {
  const parts = toAnthropicParts([{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }]);
  assert.deepEqual(parts[0], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } });
});

test("reasoning effort is clamped and passed through", () => {
  const body = buildUpstreamBody({ model: "zcode", messages: [], reasoning_effort: "max" }, ctx);
  assert.deepEqual(body.output_config, { effort: "max" });
  const weird = buildUpstreamBody({ model: "zcode", messages: [], reasoning_effort: "turbo" }, ctx);
  assert.deepEqual(weird.output_config, { effort: "high" });
});

test("streamer emits openai chunks for text, thinking and tools", () => {
  const written = [];
  const res = {
    write: (s) => written.push(s),
    end: () => written.push("__END__"),
  };
  const s = createOpenAiStreamer(res, "zcode", true);
  s.event({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hm" } });
  s.event({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t", name: "run" } });
  s.event({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"a":' } });
  s.event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hey" } });
  s.event({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { input_tokens: 5, output_tokens: 2 } });
  s.end();
  const payloads = written.filter((w) => w.startsWith("data: {")).map((w) => JSON.parse(w.slice(6)));
  assert.equal(payloads.some((p) => p.choices[0].delta.reasoning_content === "hm"), true);
  assert.equal(payloads.some((p) => p.choices[0].delta.content === "hey"), true);
  assert.equal(payloads.some((p) => p.choices[0].delta.tool_calls?.[0].function.name === "run"), true);
  assert.equal(payloads.at(-1).usage.prompt_tokens, 5);
  assert.equal(payloads.find((p) => p.choices[0].finish_reason).choices[0].finish_reason, "tool_calls");
  assert.equal(written.at(-2), "data: [DONE]\n\n");
  assert.equal(written.at(-1), "__END__");
});

test("preamble survives a windows home directory", () => {
  // C:\Users\... ломает JSON, если подставлять путь по сырому тексту
  const home = "C:\\Users\\vova";
  const blocks = loadPreamble(undefined, home);
  const joined = JSON.stringify(blocks);
  assert.ok(blocks.length === 3);
  assert.ok(joined.includes("C:\\\\Users\\\\vova"), "home substituted");
  assert.ok(!joined.includes("/home/vlelyavin"), "no leftover absolute path");
});

test("model ids resolve from canonical, legacy and upstream forms", () => {
  const models = { "glm-5.3-flash": "GLM-5.3-Flash", "glm-5.3": "GLM-5.3" };
  assert.equal(mapModel("glm-5.3-flash", models), "GLM-5.3-Flash");
  assert.equal(mapModel("glm-5.3", models), "GLM-5.3");
  assert.equal(mapModel("zcode", models), "GLM-5.3-Flash");
  assert.equal(mapModel("zcode-5.3", models), "GLM-5.3");
  assert.equal(mapModel("GLM-5.3-Flash", models), "GLM-5.3-Flash");
  assert.equal(mapModel("GLM-5.3", models), "GLM-5.3");
  assert.equal(mapModel("", models), "GLM-5.3-Flash");
});
