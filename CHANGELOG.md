# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add Soniox async STT provider (`SONIOX_API_KEY`, model `stt-async-v5`, via the
  Files + Transcriptions API with bounded polling and best-effort cleanup). (#20,
  @TomGrozev)

## [0.7.0] - 2026-09-07

### Added

- The `ffmpeg` recorder now detects digital silence (a valid-size WAV whose peak
  sample amplitude is at or below `SILENCE_MAX_AMPLITUDE`) and fails with a
  "Recording is silent" error instead of sending silent audio to the provider
  and surfacing a confusing empty-transcription error. This matches the existing
  silence detection in the bridge recorder; the shared WAV amplitude helper
  lives in `src/audio/wav.ts`.

### Changed

- Capture troubleshooting in the README now covers silent recordings and the
  empty-transcription error they cause, and calls out virtual devices
  (ZoomAudioDevice, BlackHole, OBS) that can occupy `:0` on macOS.

### Fixed

- Windows `ffmpeg` capture no longer produces 0-byte WAV files: stopping a
  recording now signals ffmpeg through stdin (`"q\n"`) on Windows instead of
  `SIGINT` (which maps to `TerminateProcess` and kills ffmpeg before it can
  flush the WAV buffers). DirectShow captures also use `-audio_buffer_size 20`
  for lower startup latency. (#19, @NeetigyaShah)
- The editor wrapper now transparently forwards unknown editor methods to the
  wrapped base editor (including `setUseTerminalCursor`) so host-side editor
  API additions keep working, and startup guards `ctx.ui.getEditorComponent` /
  `ctx.ui.setEditorComponent` with a warning when the host UI lacks them.
  The dictation toggle is debounced (400 ms) against rapid double-events.
  (#19, @NeetigyaShah)

## [0.6.0] - 2026-08-09

### Added

- Local `--local` installer mode for the Mac microphone bridge: installs only the native loopback recorder with no SSH or `~/.ssh/config` changes, so Pi running on the same Mac can use the native AVFoundation recorder when direct `ffmpeg` capture cannot receive microphone frames. The default `ffmpeg` recorder is unchanged. (#16, @GratefulDave)

### Fixed

- The bridge installer now warns when `--local` is combined with a VPS host argument instead of ignoring it silently.

### Changed

- Documentation restructured to present the local bridge topology as the simplest setup, with VPS-over-SSH as the advanced case.

## [0.5.1] - 2026-08-07

### Fixed

- Restore the base editor's default border color when idle instead of clearing
  it to `undefined`, which crashed pi 0.80.x with `TypeError: this.borderColor
  is not a function` during render. The recording/processing tint is still
  cleared after dictation ends. (#15)

## [0.5.0] - 2026-08-01

### Added

- Named profiles: define multiple configurations (provider, capture, cleanup…) under the top-level `profiles` key and switch between them at runtime.
- Profile switch menu bound to `Alt+R` by default (`profileKeybind` / `PI_STT_PROFILE_KEYBIND`), plus the `/stt profile [name]` command; `Ctrl+Shift+R` is also supported on terminals that forward the Kitty keyboard protocol (pi-tui misreads the Kitty shift+ctrl modifier otherwise).
- The last selected profile is persisted in a sidecar state file (`<config path>.profile.json`) and reused as the default for every session (`PI_STT_PROFILE` env overrides).
- The active profile is shown in the input-border indicator (`voice · local`).
- Switching a profile that changes the provider or capture type replaces that block entirely, so base fields (endpoint, model, apiKey) never leak into the new provider.

## [0.4.1] - 2026-07-13

### Fixed

- Avoid a crash on pi 0.80.x where deleting the editor `borderColor` throws (the
  property is non-configurable / proxy-trapped in newer pi-tui). The idle state
  now clears the recording/processing tint via assignment instead of `delete`, so
  the prompt border no longer stays red/orange after dictation. (#13)

## [0.4.0] - 2026-07-13

### Added

- Optional Mac microphone bridge for VPS usage: when Pi runs on a VPS over SSH,
  `capture.type: "bridge"` delegates recording to a small local Mac daemon via a
  reverse SSH tunnel (loopback-only, bearer-token auth). Includes a generic
  one-command installer, a native macOS capture app, and a full setup guide in
  `docs/macos-bridge.md`. The default `ffmpeg` recorder is unchanged.
- Voice commands: end a dictation with a keyword to trigger an action
  (`commands.*`, disabled by default). Built-in actions `send`, `clear` and
  `newline`, with configurable, localizable keywords.
- Modes: named presets (`mode` / `modes`, `/stt mode <name>`) that deep-merge
  over the base config. Built-in `default` and `raw` (skips cleanup).
- `output.replacements`: a literal, case-insensitive dictionary applied to the
  raw transcript before cleanup (e.g. `{ "super base": "Supabase" }`).
- `provider.language: "auto"` (and empty) now explicitly auto-detects the
  spoken language across all providers, enabling code-switching.
- AI smart cleanup (`cleanup.*`, disabled by default): run the raw transcript
  through an OpenAI-compatible chat endpoint to fix punctuation, capitalization,
  remove filler words and spell project-specific terms correctly. Supports a
  glossary (`projectTerms`), optional git-branch context (`useRepoContext`) and
  a configurable target language. Falls back to the raw transcript on failure,
  with a distinct `polishing` indicator state.
- `output.submitOnStop` option: stopping a recording with the `Ctrl+R` toggle
  can now send the transcript straight to chat instead of only inserting it.
- Clearer recording indicator: red blinking dot while recording, orange while
  transcribing, and the whole prompt border is tinted to match the state.
- Localization layer (`src/i18n/`) with a `locale` setting. Runtime labels and
  toasts default to English and can be switched (built-in `en` and `fr` packs).

### Fixed

- "Recording is too small" now explains the likely cause (an empty PulseAudio
  default source on Linux while ALSA works) and points to `capture.inputFormat`/
  `capture.input`, device listing (`pactl`/`arecord -L`), and the ALSA fallback.
  The README gains a dedicated capture-troubleshooting subsection. (#4)

[Unreleased]: https://github.com/cgarrot/pi-voice-stt/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/cgarrot/pi-voice-stt/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/cgarrot/pi-voice-stt/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/cgarrot/pi-voice-stt/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/cgarrot/pi-voice-stt/releases/tag/v0.4.1
[0.4.0]: https://github.com/cgarrot/pi-voice-stt/releases/tag/v0.4.0
