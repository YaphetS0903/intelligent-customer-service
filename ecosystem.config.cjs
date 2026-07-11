module.exports = {
  apps: [
    {
      name: "tianrui-ai-support",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "768M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "3000"
      }
    }
  ]
};
