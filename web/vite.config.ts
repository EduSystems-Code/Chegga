import { defineConfig } from "vite";

// Pinned, distinct port from the old Chegga frontend (which defaults to
// Vite's own 5173) -- both apps used to land on the same URL with nothing
// but the browser tab's title to tell them apart, which is the actual
// root cause of "I can't tell which one I'm pulling up." strictPort
// means a stale process squatting on 5174 fails loudly instead of Vite
// silently handing you 5175 next time.
//
// `npm run dev` (with HMR) is for a real external browser. For VS Code's
// Simple Browser use `npm run dev:vscode` instead: it builds and serves
// the static production bundle via `vite preview`, with NO HMR client and
// NO WebSocket. The Simple Browser is an embedded webview whose HMR
// WebSocket drops intermittently; each drop makes Vite's client call
// `location.reload()`, and repeated programmatic reloads leave the webview
// painting the page but no longer routing clicks into it -- the recurring
// "worked for a bit, then every button went dead." A static server has
// nothing to reconnect, so nothing to reload. Trade-off: re-run
// `npm run dev:vscode` and hit Simple Browser's reload after an edit.
export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
});
