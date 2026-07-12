import { CustomEditor, type AppKeybinding, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorComponent,
  type EditorTheme,
  type KeyId,
  type TUI,
} from "@earendil-works/pi-tui";
import type { DictationMode } from "../core/dictation-controller";
import type { Strings } from "../i18n/strings";

type VoiceEditorOptions = {
  keybind: string;
  ctx: ExtensionContext;
  getMode(): DictationMode;
  renderLabel(theme: Theme): string;
  onToggle(ctx: ExtensionContext): void;
  onCancel(ctx: ExtensionContext): void;
  onSend(ctx: ExtensionContext): void;
};

const injectRightLabel = (line: string, width: number, label: string): string => {
  const labelWidth = visibleWidth(label);
  if (width <= 0) return "";
  if (labelWidth <= 0) return truncateToWidth(line, width, "");
  if (labelWidth >= width) return truncateToWidth(label, width, "");

  const gap = " ";
  const leftWidth = Math.max(0, width - labelWidth - visibleWidth(gap));
  const left = truncateToWidth(line, leftWidth, "");
  return truncateToWidth(`${left}${gap}${label}`, width, "");
};

class VoiceEditorWrapper implements EditorComponent {
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;
  borderColor?: (str: string) => string;

  constructor(
    private readonly base: EditorComponent,
    private readonly options: VoiceEditorOptions,
  ) {}

  // Proxy CustomEditor action handlers and app-level callbacks to the base
  // editor so pi's interactive mode can duck-type and set them properly.
  // Without this, app.exit (Ctrl+D), app.interrupt (Escape), paste-image,
  // and extension shortcuts are silently swallowed.
  private get baseRecord(): Record<string, unknown> {
    return this.base as unknown as Record<string, unknown>;
  }

  get actionHandlers(): Map<string, () => void> | undefined {
    return this.baseRecord.actionHandlers as Map<string, () => void> | undefined;
  }

  get onCtrlD(): (() => void) | undefined {
    return this.baseRecord.onCtrlD as (() => void) | undefined;
  }
  set onCtrlD(handler: (() => void) | undefined) {
    this.baseRecord.onCtrlD = handler;
  }

  get onEscape(): (() => void) | undefined {
    return this.baseRecord.onEscape as (() => void) | undefined;
  }
  set onEscape(handler: (() => void) | undefined) {
    this.baseRecord.onEscape = handler;
  }

  get onPasteImage(): (() => void) | undefined {
    return this.baseRecord.onPasteImage as (() => void) | undefined;
  }
  set onPasteImage(handler: (() => void) | undefined) {
    this.baseRecord.onPasteImage = handler;
  }

  get onExtensionShortcut(): ((data: string) => void) | undefined {
    return this.baseRecord.onExtensionShortcut as ((data: string) => void) | undefined;
  }
  set onExtensionShortcut(handler: ((data: string) => void) | undefined) {
    this.baseRecord.onExtensionShortcut = handler;
  }

  private syncBase(): void {
    if (this.onSubmit) this.base.onSubmit = this.onSubmit;
    else delete this.base.onSubmit;

    if (this.onChange) this.base.onChange = this.onChange;
    else delete this.base.onChange;

    if (this.borderColor) this.base.borderColor = this.borderColor;
  }

  get focused(): boolean {
    return Boolean((this.base as EditorComponent & { focused?: boolean }).focused);
  }

  set focused(value: boolean) {
    (this.base as EditorComponent & { focused?: boolean }).focused = value;
  }

  // While recording/processing, tint the whole prompt border so the state is
  // impossible to miss (red = recording, orange = transcribing). Idle restores
  // whatever border color pi set on the wrapper.
  private applyModeBorder(): void {
    const mode = this.options.getMode();
    const theme = this.options.ctx.ui.theme;
    if (mode === "recording") this.base.borderColor = (str: string) => theme.fg("error", str);
    else if (mode === "processing") this.base.borderColor = (str: string) => theme.fg("warning", str);
    else if (mode === "polishing") this.base.borderColor = (str: string) => theme.fg("accent", str);
    else if (this.borderColor) this.base.borderColor = this.borderColor;
    else delete (this.base as EditorComponent & { borderColor?: (str: string) => string }).borderColor;
  }

  render(width: number): string[] {
    this.syncBase();
    this.applyModeBorder();
    const lines = this.base.render(width);
    if (lines.length === 0) return lines;

    const label = this.options.renderLabel(this.options.ctx.ui.theme);
    lines[0] = injectRightLabel(lines[0] ?? "", width, label);
    return lines;
  }

  handleInput(data: string): void {
    this.syncBase();
    const mode = this.options.getMode();

    if (matchesKey(data, this.options.keybind as KeyId)) {
      this.options.onToggle(this.options.ctx);
      return;
    }

    if (mode !== "idle" && matchesKey(data, "escape")) {
      this.options.onCancel(this.options.ctx);
      return;
    }

    if (mode === "recording" && matchesKey(data, "enter")) {
      this.options.onSend(this.options.ctx);
      return;
    }

    this.base.handleInput(data);
  }

  invalidate(): void {
    this.base.invalidate();
  }

  getText(): string {
    return this.base.getText();
  }

  setText(text: string): void {
    this.syncBase();
    this.base.setText(text);
  }

  addToHistory(text: string): void {
    this.base.addToHistory?.(text);
  }

  insertTextAtCursor(text: string): void {
    this.base.insertTextAtCursor?.(text);
  }

  getExpandedText(): string {
    return this.base.getExpandedText?.() ?? this.base.getText();
  }

  setAutocompleteProvider(provider: Parameters<NonNullable<EditorComponent["setAutocompleteProvider"]>>[0]): void {
    this.base.setAutocompleteProvider?.(provider);
  }

  setPaddingX(padding: number): void {
    this.base.setPaddingX?.(padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.base.setAutocompleteMaxVisible?.(maxVisible);
  }

  dispose(): void {
    (this.base as EditorComponent & { dispose?: () => void }).dispose?.();
  }
}

const PROCESSING_FRAMES = ["•  ", " • ", "  •", " • "];

export const createInputIndicator = (keybind: string, strings: Strings) => {
  let mode: DictationMode = "idle";
  let tui: TUI | undefined;
  let tick = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const requestRender = () => tui?.requestRender();

  const stopAnimation = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };

  const startAnimation = () => {
    if (timer || mode === "idle") return;
    timer = setInterval(() => {
      tick += 1;
      requestRender();
    }, 120);
  };

  const syncAnimation = () => {
    if (mode === "idle") stopAnimation();
    else startAnimation();
  };

  return {
    attach(tuiInstance: TUI) {
      tui = tuiInstance;
      syncAnimation();
      requestRender();
    },
    setMode(nextMode: DictationMode) {
      mode = nextMode;
      tick += 1;
      syncAnimation();
      requestRender();
    },
    renderLabel(theme: Theme): string {
      if (mode === "recording") {
        // Clear on/off blink in red so the recording state is obvious.
        const dot = tick % 2 === 0 ? "●" : "○";
        return `${theme.fg("error", dot)} ${theme.fg("error", strings.indicator.recording)} ${theme.fg("dim", strings.indicator.recordingHint)}`;
      }

      if (mode === "processing") {
        const frame = PROCESSING_FRAMES[tick % PROCESSING_FRAMES.length] ?? "…";
        return `${theme.fg("warning", frame)} ${theme.fg("warning", strings.indicator.transcribing)} ${theme.fg("dim", strings.indicator.transcribingHint)}`;
      }

      if (mode === "polishing") {
        const frame = PROCESSING_FRAMES[tick % PROCESSING_FRAMES.length] ?? "…";
        return `${theme.fg("accent", frame)} ${theme.fg("accent", strings.indicator.polishing)} ${theme.fg("dim", strings.indicator.polishingHint)}`;
      }

      return `${theme.fg("dim", strings.indicator.idle)} ${theme.fg("accent", keybind)}`;
    },
    dispose() {
      stopAnimation();
      tui = undefined;
      mode = "idle";
    },
  };
};

export const createVoiceEditorFactory = (
  previousFactory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
  options: VoiceEditorOptions & { attachTui(tui: TUI): void },
) => {
  return (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager): EditorComponent => {
    options.attachTui(tui);
    const base = previousFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
    return new VoiceEditorWrapper(base, options);
  };
};
