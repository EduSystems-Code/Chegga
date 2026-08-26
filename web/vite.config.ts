import { defineConfig } from "vite";

// Pinned, distinct port from the old Chegga frontend (which defaults to
// Vite's own 5173) -- both apps used to land on the same URL with nothing
// but the browser tab's title to tell them apart, which is the actual
// root cause of "I can't tell which one I'm pulling up." strictPort
// means a stale process squatting on 5174 fails loudly instead of Vite
// silently handing you 5175 next time.
export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
});
