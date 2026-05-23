import { CustomEditor, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
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

  render(width: number): string[] {
    this.syncBase();
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

export const createInputIndicator = (keybind: string) => {
  let mode: DictationMode = "idle";
  let tui: TUI | undefined;

  const requestRender = () => tui?.requestRender();

  return {
    attach(tuiInstance: TUI) {
      tui = tuiInstance;
      requestRender();
    },
    setMode(nextMode: DictationMode) {
      mode = nextMode;
      requestRender();
    },
    renderLabel(theme: Theme): string {
      if (mode === "recording") {
        return `${theme.fg("accent", "●")} ${theme.fg("muted", "recording")} ${theme.fg("dim", "· enter send · esc cancel")}`;
      }

      if (mode === "processing") {
        return `${theme.fg("accent", "…")} ${theme.fg("muted", "transcribing")} ${theme.fg("dim", "· esc cancel")}`;
      }

      return `${theme.fg("dim", "voice")} ${theme.fg("accent", keybind)}`;
    },
    dispose() {
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
