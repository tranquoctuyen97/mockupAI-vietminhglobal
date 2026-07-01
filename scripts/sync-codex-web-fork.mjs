import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const forkUrl = process.env.CODEX_WEB_FORK_URL || "git@github.com:tranquoctuyen97/codex-web.git";
const upstreamUrl = process.env.CODEX_WEB_UPSTREAM_URL || "git@github.com:0xcaff/codex-web.git";
const branch = process.env.CODEX_WEB_BRANCH || "mockupai-workspace-allowlist";
const workdir = process.env.CODEX_WEB_SYNC_DIR || "/tmp/mockupai-codex-web";

function run(command, args, cwd = workdir) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

await mkdir(path.dirname(workdir), { recursive: true });

if (!existsSync(path.join(workdir, ".git"))) {
  run("git", ["clone", forkUrl, workdir], path.dirname(workdir));
}

run("git", ["remote", "set-url", "origin", forkUrl]);
try {
  run("git", ["remote", "add", "upstream", upstreamUrl]);
} catch {
  run("git", ["remote", "set-url", "upstream", upstreamUrl]);
}

run("git", ["fetch", "origin"]);
run("git", ["fetch", "upstream"]);
run("git", ["checkout", branch]);
run("git", ["merge", "upstream/main"]);

try {
  run("npm", ["test"]);
} catch {
  console.warn("codex-web test command failed or is unavailable; run manual smoke before promoting.");
}

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workdir, encoding: "utf8" }).trim();
console.log(`Synced codex-web fork branch ${branch}`);
console.log(`Pin candidate: git+ssh://git@github.com/tranquoctuyen97/codex-web.git#${sha}`);
