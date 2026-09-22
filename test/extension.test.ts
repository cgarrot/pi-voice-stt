import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import extension from "../src/index";
import { audioFixture } from "./helpers";

test("Pi registers and executes the audio tool and file command with active profiles and modes", async (t) => {
  const { cwd, path } = await audioFixture(t, "My  meeting.m4a");
  const configPath = join(cwd, "stt.json");
  await writeFile(configPath, JSON.stringify({
    provider: { type: "mistral", apiKey: "test-key" },
    output: { replacements: { "super base": "Supabase" }, submitOnStop: true },
    commands: { enabled: true, send: ["send"], clear: ["clear"], newline: ["new line"] },
    profiles: { local: {
      provider: { type: "openai-compatible", endpoint: "http://127.0.0.1:8788/v1/audio/transcriptions", model: "test-model", language: "fr" },
      cleanup: { enabled: true, endpoint: "http://127.0.0.1:8788/v1/chat/completions", model: "cleanup-model" },
    } },
  }));
  // Honor the persisted profile even when a tool runs before session_start.
  await writeFile(`${configPath}.profile.json`, JSON.stringify({ profile: "local" }));
  for (const [key, value] of Object.entries({ PI_STT_CONFIG: configPath, PI_STT_MODE: "default", PI_STT_PROFILE: "", PI_STT_LOCALE: "en" })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  let command!: Parameters<ExtensionAPI["registerCommand"]>[1];
  let tool!: ToolDefinition;
  let shutdown!: () => Promise<void>;
  extension({
    registerCommand: (name: string, definition: typeof command) => { assert.equal(name, "stt"); command = definition; },
    registerTool: (definition: ToolDefinition) => { tool = definition; },
    registerShortcut: () => {},
    on: (name: string, handler: () => Promise<void>) => { if (name === "session_shutdown") shutdown = handler; },
    sendUserMessage: () => assert.fail("file transcription must never send a prompt"),
  } as unknown as ExtensionAPI);
  t.after(() => shutdown());
  let editor = "Existing prompt. ";
  const notifications: string[] = [];
  const ctx = {
    cwd, hasUI: true, signal: undefined,
    ui: {
      getEditorText: () => editor,
      setEditorText: (text: string) => { editor = text; },
      notify: (text: string) => { notifications.push(text); },
    },
  } as unknown as ExtensionCommandContext;
  let transcript = "super base send";
  let cleanupCalls = 0;
  let providerCalls = 0;
  let failProvider = false;
  let lastModel = "";
  let expectedFilename = "My  meeting.m4a";
  let expectedMime = "audio/mp4";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/chat/completions")) {
      cleanupCalls++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.messages[1].content, "Supabase send");
      return Response.json({ choices: [{ message: { content: "Cleaned meeting send" } }] });
    }
    providerCalls++;
    if (failProvider) return new Response("file too long", { status: 413 });
    assert.ok(init.body instanceof FormData);
    const file = init.body.get("file") as File;
    assert.equal(file.name, expectedFilename);
    assert.equal(file.type, expectedMime);
    lastModel = String(init.body.get("model"));
    if (lastModel === "test-model") assert.equal(init.body.get("language"), "fr");
    return Response.json({ text: transcript });
  });

  assert.equal(tool.name, "transcribe_audio");
  assert.deepEqual(tool.parameters, {
    type: "object", properties: { path: { type: "string", minLength: 1, description: "Local audio file path, relative to the session working directory or absolute." } },
    required: ["path"], additionalProperties: false,
  });
  assert.deepEqual(command.getArgumentCompletions?.("fi"), [{ value: "file", label: "file" }]);
  const initialFiles = await readdir(cwd);
  const result = await tool.execute("call-1", { path: "@./My  meeting.m4a" }, undefined, undefined, ctx);
  assert.deepEqual(result.content, [{ type: "text", text: "Cleaned meeting send" }]);
  assert.deepEqual(result.details, { text: "Cleaned meeting send", provider: "openai-compatible", model: "test-model", path });
  assert.equal(editor, "Existing prompt. ");
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(await readdir(cwd), initialFiles);

  await command.handler("mode raw", ctx);
  for (const keyword of ["send", "clear", "new line"]) {
    transcript = `super base ${keyword}`;
    editor = "Keep. ";
    await command.handler('file "./My  meeting.m4a"', ctx);
    assert.equal(editor, `Keep. Supabase ${keyword} `);
    assert.match(notifications.at(-1)!, /Transcript inserted/);
  }
  assert.equal(cleanupCalls, 1);
  editor = "Keep. ";
  await command.handler(`file ${path}`, ctx);
  assert.equal(editor, "Keep. Supabase new line ");
  const raw = await tool.execute("raw", { path }, undefined, undefined, ctx);
  assert.deepEqual(raw.content, [{ type: "text", text: "Supabase new line" }]);
  assert.equal(cleanupCalls, 1);
  await writeFile(join(cwd, "test.mp3"), "fake audio");
  expectedFilename = "test.mp3";
  expectedMime = "audio/mpeg";
  editor = "";
  await command.handler("file ./test.mp3", ctx);
  assert.equal(editor, "Supabase new line ");
  expectedFilename = "My  meeting.m4a";
  expectedMime = "audio/mp4";
  await command.handler("profile default", ctx);
  await tool.execute("call-2", { path }, undefined, undefined, { ...ctx, hasUI: false });
  assert.notEqual(lastModel, "test-model");

  editor = "Do not change";
  failProvider = true;
  const callsBefore = providerCalls;
  await command.handler(`file "${path}"`, ctx);
  assert.equal(providerCalls, callsBefore + 1);
  assert.match(notifications.at(-1)!, /mistral.*10 bytes.*413.*file too long/);
  assert.equal(editor, "Do not change");
  await command.handler("file", ctx);
  assert.match(notifications.at(-1)!, /Usage: \/stt file/);
  await command.handler('file "unfinished.mp3', ctx);
  assert.match(notifications.at(-1)!, /Unclosed quote/);
  await command.handler("file ./missing.wav", ctx);
  assert.match(notifications.at(-1)!, /Cannot read audio file/);
  assert.equal(editor, "Do not change");
  await command.handler("unknown", ctx);
  assert.match(notifications.at(-1)!, /file <path>/);

  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(tool.execute("cancelled", { path }, cancelled.signal, undefined, ctx), { name: "AbortError" });
  await command.handler(`file "${path}"`, { ...ctx, signal: cancelled.signal });
  assert.equal(editor, "Do not change");
});
