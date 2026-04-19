import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMissionControlApp, FileBackedSessionStore } from "./index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3040);

const app = createMissionControlApp({
  publicDir: path.join(appRoot, "public"),
  sessionStore: new FileBackedSessionStore({
    rootDir: path.join(appRoot, ".data", "sessions"),
  }),
});

app.server.listen(port, host, () => {
  console.log(`AGRO Mission Control listening on http://${host}:${port}`);
});
