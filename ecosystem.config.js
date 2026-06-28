module.exports = {
  apps: [
    {
      name: "mockupai",
      script: "node",
      args: ".next/standalone/server.js",
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
  ],
};
