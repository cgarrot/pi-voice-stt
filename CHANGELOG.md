# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/cgarrot/pi-voice-stt/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/cgarrot/pi-voice-stt/releases/tag/v0.4.1
[0.4.0]: https://github.com/cgarrot/pi-voice-stt/releases/tag/v0.4.0
