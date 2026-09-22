import test from "node:test";
import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { audioFileFromPath, validateAudioFile } from "../src/audio/file";
import { audioFixture } from "./helpers";

test("audio metadata preserves filenames and recognizes supported formats case-insensitively", () => {
  for (const [extension, mimeType] of Object.entries({
    wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4",
    aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm",
  })) {
    const filename = `My meeting.${extension.toUpperCase()}`;
    const path = join("recordings", filename);
    assert.deepEqual(audioFileFromPath(path), { path, filename, extension: `.${extension}`, mimeType });
  }
  assert.throws(() => audioFileFromPath("notes.txt"), /Unsupported audio format/);
});

test("file paths resolve against the session cwd, preserve spaces, and accept @", async (t) => {
  const { cwd, path } = await audioFixture(t, "My  meeting.mp3");
  for (const input of [path, `./${basename(path)}`, `@./${basename(path)}`, `../${basename(cwd)}/${basename(path)}`]) {
    const file = await validateAudioFile(input, cwd);
    assert.equal(file.path, path);
    assert.equal(file.size, 10);
    assert.equal(file.filename, "My  meeting.mp3");
  }
});

test("invalid files and remote URLs fail clearly", async (t) => {
  const { cwd } = await audioFixture(t);
  await assert.rejects(validateAudioFile("missing.wav", cwd), /Cannot read audio file.*missing.wav/);
  await assert.rejects(validateAudioFile(cwd, cwd), /not a regular file/);
  for (const path of ["https://example.com/file.mp3", "http://example.com/file.mp3", "s3://bucket/a.wav", "ftp://host/a.wav", "file:///a.wav"]) {
    await assert.rejects(validateAudioFile(path, cwd), /Only local audio files/);
  }
  await assert.rejects(validateAudioFile("@", cwd), /path is required/);
});
