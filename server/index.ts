import { createApp } from "./app";
import { getConfig } from "./config";
const config = getConfig();
const { app, db } = createApp(config);
const server = app.listen(config.port, () =>
  console.log(
    `STILLSPACE API http://localhost:${config.port} · ${config.bucket ? "private OSS" : "local demo"}`,
  ),
);
const close = () =>
  server.close(() => {
    db.close();
    process.exit(0);
  });
process.on("SIGINT", close);
process.on("SIGTERM", close);
