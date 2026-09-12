import { fileURLToPath } from "node:url";
import { createMockServer, mockDefaults } from "./server-primary.mjs";

export { createMockServer, mockDefaults };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await createMockServer({ port: Number(process.env.MOCK_PORT || 4100) });
  console.log(`[mock] listening at ${url}`);
  console.log(`[mock] state: ${process.env.MOCK_STATE_PATH || mockDefaults.defaultStatePath}`);
}
