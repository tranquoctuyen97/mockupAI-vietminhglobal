module.exports = {
  apps: [{
    name: "mockupai",
    interpreter: "bash",
    script: "./start.sh",
    cwd: ".",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    max_memory_restart: "1G",
    error_file: "/var/log/pm2/mockupai-error.log",
    out_file: "/var/log/pm2/mockupai-out.log"
  }]
};
