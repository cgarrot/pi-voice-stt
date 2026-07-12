# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `output.submitOnStop` option: stopping a recording with the `Ctrl+R` toggle
  can now send the transcript straight to chat instead of only inserting it.
- Clearer recording indicator: red blinking dot while recording, orange while
  transcribing, and the whole prompt border is tinted to match the state.
- Localization layer (`src/i18n/`) with a `locale` setting. Runtime labels and
  toasts default to English and can be switched (built-in `en` and `fr` packs).

[Unreleased]: https://github.com/cgarrot/pi-voice-stt/compare/main...HEAD
