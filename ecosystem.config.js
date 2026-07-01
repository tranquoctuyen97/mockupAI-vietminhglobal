const AI_HUB_RUNTIME_HOME = process.env.AI_HUB_RUNTIME_HOME || "/tmp/ai-hub/codex-runtime/home";
const AI_HUB_CODEX_WEB_REF =
  process.env.AI_HUB_CODEX_WEB_REF ||
  "git+ssh://git@github.com/tranquoctuyen97/codex-web.git#mockupai-workspace-allowlist";
const AI_HUB_CODEX_WEB_PORT = process.env.AI_HUB_CODEX_WEB_PORT || "8214";

module.exports = {
  apps: [
    {
      name: "mockupai",
      script: "npm",
      args: "run start",
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        HOSTNAME: "0.0.0.0",
        STANDALONE_WORKER: "1",
        AI_HUB_IFRAME_URL: process.env.AI_HUB_IFRAME_URL || "/api/codex-proxy/",
        AI_HUB_INTERNAL_TOKEN: process.env.AI_HUB_INTERNAL_TOKEN || "",
        AI_HUB_MEMBERS_ROOT: process.env.AI_HUB_MEMBERS_ROOT || "/tmp/ai-hub/members",
        AI_HUB_SHARED_ROOT: process.env.AI_HUB_SHARED_ROOT || "/tmp/ai-hub/common",
      },
      error_file: "./logs/pm2/mockupai-error.log",
      out_file: "./logs/pm2/mockupai-out.log",
    },
    {
      name: "mockupai-worker",
      script: "npm",
      args: "run worker",
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/pm2/mockupai-worker-error.log",
      out_file: "./logs/pm2/mockupai-worker-out.log",
    },
    {
      name: "mockupai-codex",
      script: "npx",
      args: `--yes ${AI_HUB_CODEX_WEB_REF}`,
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: AI_HUB_CODEX_WEB_PORT,
        CODEX_CLI_PATH: process.env.CODEX_CLI_PATH || "/home/codexbot/.local/bin/codex",
        HOME: AI_HUB_RUNTIME_HOME,
        CODEX_HOME: `${AI_HUB_RUNTIME_HOME}/.codex`,
        AI_HUB_WORKSPACES_URL:
          process.env.AI_HUB_WORKSPACES_URL ||
          "http://127.0.0.1:3001/api/internal/ai-hub/workspaces?provider=codex",
        AI_HUB_INTERNAL_TOKEN: process.env.AI_HUB_INTERNAL_TOKEN || "",
        NPM_CONFIG_CACHE: process.env.AI_HUB_NPM_CACHE || `${process.env.HOME}/.npm`,
        npm_config_cache: process.env.AI_HUB_NPM_CACHE || `${process.env.HOME}/.npm`,
      },
      error_file: "./logs/pm2/mockupai-codex-error.log",
      out_file: "./logs/pm2/mockupai-codex-out.log",
    },
  ],
};
