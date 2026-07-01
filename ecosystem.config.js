require("dotenv").config();

const AI_HUB_RUNTIME_HOME = process.env.AI_HUB_RUNTIME_HOME || "/tmp/ai-hub/codex-runtime/home";
const AI_HUB_CODEX_WEB_REF =
  process.env.AI_HUB_CODEX_WEB_REF ||
  "https://github.com/tranquoctuyen97/codex-web.git";
const AI_HUB_CODEX_WEB_BRANCH = process.env.AI_HUB_CODEX_WEB_BRANCH || "mockupai-workspace-allowlist";
const AI_HUB_CODEX_WEB_DIR = process.env.AI_HUB_CODEX_WEB_DIR || "/tmp/mockupai-codex-web";
const AI_HUB_CODEX_WEB_PORT = process.env.AI_HUB_CODEX_WEB_PORT || "8214";
const AI_HUB_GATEWAY_PORT = process.env.AI_HUB_GATEWAY_PORT || "8215";
const CODEX_CLI_PATH = process.env.CODEX_CLI_PATH || "codex";
const APP_PORT = process.env.PORT || "3000";
const AI_HUB_APP_ORIGIN = process.env.AI_HUB_APP_ORIGIN || `http://127.0.0.1:${APP_PORT}`;

module.exports = {
  apps: [
    {
      name: "mockupai",
      script: ".next/standalone/server.js",
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: APP_PORT,
        HOSTNAME: "0.0.0.0",
        STANDALONE_WORKER: "1",
        AI_HUB_IFRAME_URL: process.env.AI_HUB_IFRAME_URL || "/api/codex-proxy/",
        AI_HUB_INTERNAL_TOKEN: process.env.AI_HUB_INTERNAL_TOKEN || "",
        AI_HUB_MEMBERS_ROOT: process.env.AI_HUB_MEMBERS_ROOT || "/tmp/ai-hub/members",
        AI_HUB_SHARED_ROOT: process.env.AI_HUB_SHARED_ROOT || "/tmp/ai-hub/common",
        CODEX_CLI_PATH,
      },
      error_file: "./logs/pm2/mockupai-error.log",
      out_file: "./logs/pm2/mockupai-out.log",
    },
    {
      name: "mockupai-ai-hub-gateway",
      script: "pnpm",
      args: "exec tsx scripts/ai-hub-codex-web-gateway.ts",
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        AI_HUB_GATEWAY_PORT,
        AI_HUB_APP_ORIGIN,
        CODEX_APP_URL: process.env.CODEX_APP_URL || `http://127.0.0.1:${AI_HUB_CODEX_WEB_PORT}`,
        AI_HUB_INTERNAL_TOKEN: process.env.AI_HUB_INTERNAL_TOKEN || "",
      },
      error_file: "./logs/pm2/mockupai-ai-hub-gateway-error.log",
      out_file: "./logs/pm2/mockupai-ai-hub-gateway-out.log",
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
      script: "npm",
      args: "run server",
      cwd: AI_HUB_CODEX_WEB_DIR,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: AI_HUB_CODEX_WEB_PORT,
        CODEX_CLI_PATH,
        AI_HUB_CODEX_WEB_REF,
        AI_HUB_CODEX_WEB_BRANCH,
        HOME: AI_HUB_RUNTIME_HOME,
        CODEX_HOME: `${AI_HUB_RUNTIME_HOME}/.codex`,
        AI_HUB_WORKSPACES_URL:
          process.env.AI_HUB_WORKSPACES_URL ||
          `${AI_HUB_APP_ORIGIN}/api/internal/ai-hub/workspaces?provider=codex`,
        AI_HUB_INTERNAL_TOKEN: process.env.AI_HUB_INTERNAL_TOKEN || "",
        NPM_CONFIG_CACHE: process.env.AI_HUB_NPM_CACHE || `${process.env.HOME}/.npm`,
        npm_config_cache: process.env.AI_HUB_NPM_CACHE || `${process.env.HOME}/.npm`,
      },
      error_file: "./logs/pm2/mockupai-codex-error.log",
      out_file: "./logs/pm2/mockupai-codex-out.log",
    },
  ],
};
