import { execFile } from "node:child_process";
import type { CleanupConfig } from "../config/types";
import type { RepoContext } from "./prompt";

const runGit = (args: string[], timeoutMs: number): Promise<string> =>
  new Promise((resolve) => {
    execFile("git", args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      resolve(error ? "" : stdout.toString().trim());
    });
  });

/**
 * Gather a small amount of repository context for the cleanup prompt. Failures
 * are swallowed: cleanup must never break because git is missing or the cwd is
 * not a repository.
 */
export const gatherRepoContext = async (config: CleanupConfig): Promise<RepoContext> => {
  if (!config.useRepoContext) return {};
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], 1500);
  return branch && branch !== "HEAD" ? { branch } : {};
};
