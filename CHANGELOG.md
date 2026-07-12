# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/cgarrot/pi-voice-stt/compare/main...HEAD
