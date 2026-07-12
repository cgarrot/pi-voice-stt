import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceEditorFactory } from "../src/ui/input-indicator";

test("voice editor wrapper proxies pi app-level handlers to the base editor", () => {
  const actionHandlers = new Map<string, () => void>();
  const base = {
    actionHandlers,
    render: () => [""],
    handleInput: () => {},
    invalidate: () => {},
    getText: () => "",
    setText: () => {},
  } as any;

  const factory = createVoiceEditorFactory(() => base, {
    keybind: "ctrl+r",
    ctx: { ui: { theme: {} } } as any,
    getMode: () => "idle",
    renderLabel: () => "voice ctrl+r",
    onToggle: () => {},
    onCancel: () => {},
    onSend: () => {},
    attachTui: () => {},
  });

  const editor = factory({} as any, {} as any, {} as any) as any;
  const onEscape = () => {};
  const onCtrlD = () => {};
  const onPasteImage = () => {};
  const onExtensionShortcut = () => true;
  const clear = () => {};

  assert.equal(editor.actionHandlers, actionHandlers);
  editor.actionHandlers.set("app.clear", clear);
  assert.equal(base.actionHandlers.get("app.clear"), clear);

  editor.onEscape = onEscape;
  editor.onCtrlD = onCtrlD;
  editor.onPasteImage = onPasteImage;
  editor.onExtensionShortcut = onExtensionShortcut;

  assert.equal(base.onEscape, onEscape);
  assert.equal(base.onCtrlD, onCtrlD);
  assert.equal(base.onPasteImage, onPasteImage);
  assert.equal(base.onExtensionShortcut, onExtensionShortcut);
  assert.equal(editor.onExtensionShortcut("ctrl+x"), true);
});
