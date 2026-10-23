import { execFileSync } from "node:child_process";
import {
  constants,
  openSync,
  closeSync,
  readSync,
  fstatSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { resolve, relative, extname, sep } from "node:path";
import { gitEnv } from "./service.mjs";

const FILE_LIMIT = 64 * 1024,
  TOTAL_LIMIT = 256 * 1024;
const sourceExtensions = new Set([
  ".html",
  ".css",
  ".scss",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".swift",
  ".py",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".h",
  ".java",
  ".kt",
  ".sql",
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);
const sensitive =
  /(^|\/)(\.[^/]+|node_modules|vendor)(\/|$)|credential|secret|password|token|private|id_rsa|\.(pem|key|p12|pfx)$/i;
function git(cwd, args, maxBuffer = TOTAL_LIMIT) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      env: gitEnv(),
      maxBuffer,
    });
  } catch (error) {
    if (error.code === "ENOBUFS" && error.stdout)
      return Buffer.concat([
        Buffer.from(error.stdout).subarray(0, maxBuffer),
        Buffer.from("\n[truncated]"),
      ]);
    throw error;
  }
}
export function collectRepositoryEvidence(cwd, onEvidence) {
  const root = realpathSync(cwd);
  const status = git(root, ["status", "--short", "--untracked-files=all"]);
  onEvidence("note", "Final Git status (bounded)", status.toString("utf8"));
  const tracked = git(root, ["diff", "--name-only", "-z", "HEAD", "--"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const newFiles = git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const skipped = [];
  let remaining = TOTAL_LIMIT;
  const paths = [...new Set([...tracked, ...newFiles])];
  if (paths.length > 200)
    skipped.push(`${paths.length - 200} files omitted by file-count limit`);
  for (const path of paths.slice(0, 200)) {
    if (remaining <= 0) {
      skipped.push("[remaining files omitted: total limit]");
      break;
    }
    if (
      sensitive.test(path) ||
      !sourceExtensions.has(extname(path).toLowerCase())
    ) {
      skipped.push(`${path}: sensitive/unsupported content omitted`);
      continue;
    }
    const absolute = resolve(root, path);
    if (absolute === root || !absolute.startsWith(root + sep)) {
      skipped.push(`${path}: outside worktree`);
      continue;
    }
    if (tracked.includes(path)) {
      const diff = git(
        root,
        ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", path],
        Math.min(remaining, FILE_LIMIT),
      ).toString("utf8");
      onEvidence("diff", `Tracked change: ${path}`, diff);
      remaining -= Buffer.byteLength(diff);
      continue;
    }
    let fd;
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        skipped.push(`${path}: symlink content omitted`);
        continue;
      }
      const canonical = realpathSync(absolute);
      if (
        relative(root, canonical).startsWith("..") ||
        !canonical.startsWith(root + sep)
      ) {
        skipped.push(`${path}: outside worktree`);
        continue;
      }
      fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      const actual = fstatSync(fd);
      if (!actual.isFile() || actual.nlink !== 1) {
        skipped.push(`${path}: non-regular/hardlinked content omitted`);
        continue;
      }
      const buffer = Buffer.alloc(Math.min(FILE_LIMIT, remaining, actual.size));
      const length = readSync(fd, buffer, 0, buffer.length, 0),
        data = buffer.subarray(0, length);
      if (data.includes(0)) {
        skipped.push(`${path}: binary content omitted`);
        continue;
      }
      const value =
        data.toString("utf8") + (actual.size > length ? "\n[truncated]" : "");
      onEvidence("diff", `New untracked file: ${path}`, value);
      remaining -= length;
    } catch (error) {
      skipped.push(`${path}: unreadable (${error.code ?? "error"})`);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  if (skipped.length)
    onEvidence("note", "Final snapshot omissions", skipped.join("\n"));
}
