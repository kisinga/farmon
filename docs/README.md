# MajiFlow documentation

MajiFlow is a water-orchestration platform for any installation that pumps, stores, or distributes water — irrigation systems, hospitality (hotels, resorts, lodges), greenhouses and nurseries, commercial buildings, livestock and aquaculture operations, schools and campuses, anywhere reliable water flow is critical. The same topology model, codegen pipeline, and MQTT telemetry apply across all of them; only the named tanks, valves, and routes change.

Two audiences. This folder (`docs/`) is for **contributors building MajiFlow itself**. The **installer / operator** documentation that ships inside each site's generated document lives in [`docs-content/`](../docs-content/) (operation, troubleshooting, power & wiring, per-node notes, glossary); that is its own source of truth, loaded into the app by import.

## Development — contributors

You're changing the codegen, adding a board, writing a driver.

- [development/architecture.md](development/architecture.md) — system overview
- [development/adding-boards-and-entities.md](development/adding-boards-and-entities.md) — extending hardware support
- [development/transport-driver-framework.md](development/transport-driver-framework.md) — driver safety baseline
- [sensors.md](sensors.md) — sensor placement model and the pump-safe flag
- [tunable-defaults.md](tunable-defaults.md) — the install-value-plus-live-override pattern
- [development/built.md](development/built.md) — the system as it stands today
- [development/status.md](development/status.md) — what's left to build
- [development/journal.md](development/journal.md) — history and lessons learned

## Installer / operator docs

Wiring, operation, calibration, troubleshooting and per-node notes are in [`docs-content/`](../docs-content/) (see its [README](../docs-content/README.md) for the import flow). The canonical glossary is [docs-content/glossary.md](../docs-content/glossary.md) — used by the UI, the codebase, and every other doc.
