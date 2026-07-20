# AGENTS.md

## Communication

- Be non-verbose by default. Plain language, short sentences, no filler.
- Get to the point first, details after. Use lists only when content is genuinely a set.

## Local tier architecture

The local tier is complete on its own; the cloud adds only remote reach, alerts, history and multi-site.

- **`local` topology field** — per-controller options (`buttons`, `ui`, `rtc`) on `Controller.local`, schema 19, `src/lib/topology.types.ts`.
- **Panel buttons** — `src/lib/codegen/generators/local-inputs.ts` maps board digital inputs (KC868-A16 IN1–IN16) to actions: IN1 is always Stop All, each later input toggles one route. Auto-assigned by default; an explicit `local.buttons` overrides.
- **Automation persistence** — `firmware/components/maji_automations` saves the last-good set to NVS on every apply and restores it at boot through the same validation path; schedules survive reboots and power cuts with no server.
- **On-device dashboard** (`local.ui`) — the `maji_local_ui` component replaces the stock ESPHome web_server page and serves the operator dashboard from flash: `GET /`, `GET /local/state` (SSE), `POST /local/command`, `POST /local/automations`. App bundle built with `npm run build:device` (device build uses hash-location + index fallback for SPA routes). SSE slots are released only via the httpd `free_ctx` destroy callback — never recycle a slot from the stall path.
- **RTC** (`local.rtc`) — optional DS3231 on the board I2C bus (0x68) so time-based schedules run fully offline. Default is SNTP-only; time is trusted after a valid RTC boot read or a real SNTP sync (`src/lib/codegen/generators/time-sync.ts`).
