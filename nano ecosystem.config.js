module.exports = {
  apps: [
    {
      name: "mock-server",
      script: "./mock-server/server.mjs",
      args: "4000",
      instances: 3,
      exec_mode: "cluster",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        MOCK_PORT: 4000
      }
    }
  ]
};