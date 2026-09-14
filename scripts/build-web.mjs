// Backend .env may use NODE_ENV=development; distributable UI must still use React's production runtime.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
