import { execFileSync } from "node:child_process";

function git(repositoryRoot, args) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function runtimeIdentity(repositoryRoot) {
  const commit = git(repositoryRoot, ["rev-parse", "--short=8", "HEAD"]) || null;
  const dirty = Boolean(git(repositoryRoot, ["status", "--porcelain", "--untracked-files=no"]));
  return Object.freeze({
    component: "agent-slayer",
    commit,
    dirty,
    pid: process.pid,
    startedAtUtc: new Date().toISOString(),
  });
}
