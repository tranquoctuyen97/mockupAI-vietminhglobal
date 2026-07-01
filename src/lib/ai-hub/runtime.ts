import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PROCESS_NAMES = ["mockupai-codex", "mockupai-codex-local"];
const COMMAND_TIMEOUT_MS = 15_000;
const DEVICE_AUTH_INITIAL_OUTPUT_TIMEOUT_MS = 10_000;
const DEVICE_AUTH_EXPIRY_MS = 15 * 60_000;
const CODEX_WEB_SETUP_COMPLETED_KEY = "codex-mobile-has-connected-device";
let activeDeviceAuthProcess: ChildProcess | null = null;
let activeDeviceAuthOutput = "";

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export type AiHubRuntimeStatus = {
  codexAccount: "not_connected" | "waiting_for_device_auth" | "connected";
  runtime: "stopped" | "online" | "errored" | "unknown";
  proxy: "reachable" | "unreachable";
  detail?: string;
};

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function getRuntimeHome(): string {
  return process.env.AI_HUB_RUNTIME_HOME ?? "/tmp/ai-hub/codex-runtime/home";
}

function getCodexCommand(): string {
  return process.env.CODEX_CLI_PATH ?? "codex";
}

function getRuntimeEnv(): NodeJS.ProcessEnv {
  const home = getRuntimeHome();
  mkdirSync(`${home}/.codex`, { recursive: true });

  return {
    ...process.env,
    HOME: home,
    CODEX_HOME: process.env.CODEX_HOME ?? `${home}/.codex`,
  };
}

export function markCodexWebSetupCompleted(): void {
  const statePath = `${getRuntimeHome()}/.codex/.codex-global-state.json`;
  mkdirSync(`${getRuntimeHome()}/.codex`, { recursive: true });

  let state: Record<string, unknown> = {};
  if (existsSync(statePath)) {
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    } catch {
      state = {};
    }
  }

  if (state[CODEX_WEB_SETUP_COMPLETED_KEY] === true) return;
  state[CODEX_WEB_SETUP_COMPLETED_KEY] = true;
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function clearCodexWebSetupCompleted(): void {
  const statePath = `${getRuntimeHome()}/.codex/.codex-global-state.json`;
  if (!existsSync(statePath)) return;

  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    if (state[CODEX_WEB_SETUP_COMPLETED_KEY] === undefined) return;
    delete state[CODEX_WEB_SETUP_COMPLETED_KEY];
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  } catch {}
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: getRuntimeEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

export async function checkCodexLoginStatus(): Promise<AiHubRuntimeStatus["codexAccount"]> {
  const result = await runCommand(getCodexCommand(), ["login", "status"]);
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (result.code === 0 && text.includes("logged")) {
    markCodexWebSetupCompleted();
    return "connected";
  }
  if (text.includes("device") || text.includes("waiting")) return "waiting_for_device_auth";
  clearCodexWebSetupCompleted();
  return "not_connected";
}

export async function startCodexDeviceAuth(): Promise<{ output: string }> {
  clearCodexWebSetupCompleted();

  if (activeDeviceAuthProcess && !activeDeviceAuthProcess.killed) {
    return {
      output: stripAnsi(activeDeviceAuthOutput).trim() || "Codex device auth is already running.",
    };
  }

  return new Promise((resolve) => {
    const child = spawn(getCodexCommand(), ["login", "--device-auth"], {
      env: getRuntimeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeDeviceAuthProcess = child;
    activeDeviceAuthOutput = "";
    let settled = false;

    const finish = (output: string) => {
      if (settled) return;
      settled = true;
      resolve({ output: stripAnsi(output).trim() });
    };
    const append = (chunk: Buffer) => {
      activeDeviceAuthOutput += String(chunk);
      if (
        activeDeviceAuthOutput.includes("https://auth.openai.com/codex/device") &&
        /[A-Z0-9]{4}-[A-Z0-9]{5}/.test(activeDeviceAuthOutput)
      ) {
        finish(activeDeviceAuthOutput);
      }
    };

    const initialTimer = setTimeout(() => {
      finish(activeDeviceAuthOutput || "Timed out waiting for Codex device auth output.");
    }, DEVICE_AUTH_INITIAL_OUTPUT_TIMEOUT_MS);
    const expiryTimer = setTimeout(() => child.kill("SIGTERM"), DEVICE_AUTH_EXPIRY_MS);

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("close", () => {
      clearTimeout(initialTimer);
      clearTimeout(expiryTimer);
      activeDeviceAuthProcess = null;
      if (!settled) finish(activeDeviceAuthOutput);
    });
    child.on("error", (error) => {
      clearTimeout(initialTimer);
      clearTimeout(expiryTimer);
      activeDeviceAuthProcess = null;
      finish(error.message);
    });
  });
}

export async function getCodexPm2Status(): Promise<AiHubRuntimeStatus["runtime"]> {
  const result = await runCommand("pm2", ["jlist"]);
  if (result.code !== 0) return "unknown";

  try {
    const processes = JSON.parse(result.stdout) as Array<{
      name?: string;
      pm2_env?: { status?: string };
    }>;
    const process = processes.find((item) => item.name && PROCESS_NAMES.includes(item.name));
    if (!process) return "stopped";
    if (process.pm2_env?.status === "online") return "online";
    if (process.pm2_env?.status === "errored") return "errored";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function restartCodexPm2(): Promise<{ ok: boolean; output: string }> {
  const status = await runCommand("pm2", ["jlist"]);
  let processName = PROCESS_NAMES[0];
  try {
    const processes = JSON.parse(status.stdout) as Array<{
      name?: string;
      pm2_env?: { status?: string };
    }>;
    processName =
      processes.find(
        (item) => item.name && PROCESS_NAMES.includes(item.name) && item.pm2_env?.status === "online",
      )?.name ??
      processes.find((item) => item.name && PROCESS_NAMES.includes(item.name))?.name ??
      PROCESS_NAMES[0];
  } catch {}

  if ((await checkCodexLoginStatus()) === "connected") markCodexWebSetupCompleted();
  const result = await runCommand("pm2", ["restart", processName], 30_000);
  return {
    ok: result.code === 0,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

export async function logoutCodex(): Promise<{ ok: boolean; output: string }> {
  const result = await runCommand(getCodexCommand(), ["logout"]);
  clearCodexWebSetupCompleted();
  return {
    ok: result.code === 0,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

export async function checkCodexProxyReachable(): Promise<AiHubRuntimeStatus["proxy"]> {
  try {
    const res = await fetch(process.env.CODEX_APP_URL ?? "http://127.0.0.1:8214", {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok || res.status < 500 ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function getAiHubRuntimeStatus(): Promise<AiHubRuntimeStatus> {
  const [codexAccount, runtime, proxy] = await Promise.all([
    checkCodexLoginStatus(),
    getCodexPm2Status(),
    checkCodexProxyReachable(),
  ]);

  return {
    codexAccount,
    runtime: runtime === "unknown" && proxy === "reachable" ? "online" : runtime,
    proxy,
  };
}
