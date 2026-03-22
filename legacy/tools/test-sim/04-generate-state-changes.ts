/**
 * Step 4: Generate state change events for devices with controls.
 *
 * Simulates:
 *   Water Monitor — pump on/off cycles during irrigation windows
 *   Solar Farm    — valve open/close cycles during irrigation
 *
 * Also inserts device_controls current state and some command history.
 */
import PocketBase from "pocketbase";
import {
  PB_URL, DEVICES, DAYS, startDate, now,
  hourOfDay, authPb, step, ok, info, err,
} from "./config.js";

const pb = new PocketBase(PB_URL);

interface StateEvent {
  device_eui: string;
  control_key: string;
  old_state: string;
  new_state: string;
  reason: string;
  ts: Date;
}

function generatePumpEvents(): StateEvent[] {
  const events: StateEvent[] = [];
  const eui = DEVICES.waterMonitor.eui;
  let currentState = "off";

  // For each day, pump runs during irrigation windows
  for (let day = 0; day < DAYS; day++) {
    const baseMs = startDate.getTime() + day * 24 * 60 * 60 * 1000;

    // Morning irrigation: 6:00 - 6:45
    const morningOn = new Date(baseMs + 6 * 3600 * 1000 + Math.random() * 5 * 60 * 1000);
    const morningOff = new Date(morningOn.getTime() + (40 + Math.random() * 10) * 60 * 1000);

    // Evening irrigation: 17:00 - 17:45
    const eveningOn = new Date(baseMs + 17 * 3600 * 1000 + Math.random() * 5 * 60 * 1000);
    const eveningOff = new Date(eveningOn.getTime() + (35 + Math.random() * 15) * 60 * 1000);

    if (morningOn <= now) {
      events.push({ device_eui: eui, control_key: "pump", old_state: "off", new_state: "on", reason: "RULE", ts: morningOn });
      currentState = "on";
    }
    if (morningOff <= now) {
      events.push({ device_eui: eui, control_key: "pump", old_state: "on", new_state: "off", reason: "RULE", ts: morningOff });
      currentState = "off";
    }
    if (eveningOn <= now) {
      events.push({ device_eui: eui, control_key: "pump", old_state: "off", new_state: "on", reason: "RULE", ts: eveningOn });
      currentState = "on";
    }
    if (eveningOff <= now) {
      events.push({ device_eui: eui, control_key: "pump", old_state: "on", new_state: "off", reason: "RULE", ts: eveningOff });
      currentState = "off";
    }

    // Occasional manual override on day 3 and 5
    if ((day === 2 || day === 4) && day < DAYS) {
      const manualOn = new Date(baseMs + 14 * 3600 * 1000); // 2 PM manual pump test
      const manualOff = new Date(manualOn.getTime() + 5 * 60 * 1000); // 5 min
      if (manualOn <= now) {
        events.push({ device_eui: eui, control_key: "pump", old_state: currentState, new_state: "on", reason: "DOWNLINK", ts: manualOn });
      }
      if (manualOff <= now) {
        events.push({ device_eui: eui, control_key: "pump", old_state: "on", new_state: "off", reason: "DOWNLINK", ts: manualOff });
      }
    }
  }

  return events;
}

function generateValveEvents(): StateEvent[] {
  const events: StateEvent[] = [];
  const eui = DEVICES.waterMonitor.eui;

  // Valve follows pump but with slight delay
  for (let day = 0; day < DAYS; day++) {
    const baseMs = startDate.getTime() + day * 24 * 60 * 60 * 1000;

    const morningOpen = new Date(baseMs + 6 * 3600 * 1000 + 30 * 1000); // 30s after pump
    const morningClose = new Date(baseMs + 6.75 * 3600 * 1000 - 30 * 1000); // 30s before pump off
    const eveningOpen = new Date(baseMs + 17 * 3600 * 1000 + 30 * 1000);
    const eveningClose = new Date(baseMs + 17.75 * 3600 * 1000 - 30 * 1000);

    for (const [openTs, closeTs] of [[morningOpen, morningClose], [eveningOpen, eveningClose]]) {
      if (openTs <= now) {
        events.push({ device_eui: eui, control_key: "valve", old_state: "closed", new_state: "open", reason: "RULE", ts: openTs });
      }
      if (closeTs <= now) {
        events.push({ device_eui: eui, control_key: "valve", old_state: "open", new_state: "closed", reason: "RULE", ts: closeTs });
      }
    }
  }

  return events;
}

function generateSolarValveEvents(): StateEvent[] {
  const events: StateEvent[] = [];
  const eui = DEVICES.solarFarm.eui;

  for (let day = 0; day < DAYS; day++) {
    const baseMs = startDate.getTime() + day * 24 * 60 * 60 * 1000;

    // Single irrigation window: 6:00-6:30
    const open = new Date(baseMs + 6 * 3600 * 1000);
    const close = new Date(baseMs + 6.5 * 3600 * 1000);

    if (open <= now) {
      events.push({ device_eui: eui, control_key: "valve", old_state: "closed", new_state: "open", reason: "RULE", ts: open });
    }
    if (close <= now) {
      events.push({ device_eui: eui, control_key: "valve", old_state: "open", new_state: "closed", reason: "RULE", ts: close });
    }

    // Evening: 17:00-17:30
    const open2 = new Date(baseMs + 17 * 3600 * 1000);
    const close2 = new Date(baseMs + 17.5 * 3600 * 1000);
    if (open2 <= now) {
      events.push({ device_eui: eui, control_key: "valve", old_state: "closed", new_state: "open", reason: "RULE", ts: open2 });
    }
    if (close2 <= now) {
      events.push({ device_eui: eui, control_key: "valve", old_state: "open", new_state: "closed", reason: "RULE", ts: close2 });
    }
  }

  return events;
}

async function insertStateChanges(events: StateEvent[]) {
  for (const e of events) {
    await pb.collection("state_changes").create({
      device_eui: e.device_eui,
      control_key: e.control_key,
      old_state: e.old_state,
      new_state: e.new_state,
      reason: e.reason,
      ts: e.ts.toISOString().replace("T", " ").slice(0, 19),
    });
  }
}

async function insertCommands() {
  step("Generating command history");

  const commands = [
    { device_eui: DEVICES.waterMonitor.eui, command_key: "status",   initiated_by: "api", status: "sent", ts: -6 },
    { device_eui: DEVICES.waterMonitor.eui, command_key: "status",   initiated_by: "api", status: "acked", ts: -6 },
    { device_eui: DEVICES.waterMonitor.eui, command_key: "interval", initiated_by: "api", status: "sent", ts: -4 },
    { device_eui: DEVICES.waterMonitor.eui, command_key: "interval", initiated_by: "api", status: "acked", ts: -4 },
    { device_eui: DEVICES.waterMonitor.eui, command_key: "ctrl:pump=on",  initiated_by: "api", status: "sent", ts: -2 },
    { device_eui: DEVICES.waterMonitor.eui, command_key: "ctrl:pump=off", initiated_by: "api", status: "sent", ts: -2 },
    { device_eui: DEVICES.solarFarm.eui,    command_key: "status",   initiated_by: "api", status: "sent", ts: -5 },
    { device_eui: DEVICES.solarFarm.eui,    command_key: "status",   initiated_by: "api", status: "acked", ts: -5 },
    { device_eui: DEVICES.solarFarm.eui,    command_key: "reboot",   initiated_by: "api", status: "sent", ts: -1 },
  ];

  for (const cmd of commands) {
    const sentAt = new Date(now.getTime() + cmd.ts * 24 * 3600 * 1000 + Math.random() * 3600 * 1000);
    await pb.collection("commands").create({
      device_eui: cmd.device_eui,
      command_key: cmd.command_key,
      initiated_by: cmd.initiated_by,
      status: cmd.status,
      sent_at: sentAt.toISOString().replace("T", " ").slice(0, 19),
    });
  }
  ok(`${commands.length} command records inserted`);
}

async function main() {
  await authPb(pb);

  // --- State changes ---
  step("Generating pump state changes (Water Monitor)");
  const pumpEvents = generatePumpEvents();
  await insertStateChanges(pumpEvents);
  ok(`${pumpEvents.length} pump state changes`);

  step("Generating valve state changes (Water Monitor)");
  const valveEvents = generateValveEvents();
  await insertStateChanges(valveEvents);
  ok(`${valveEvents.length} valve state changes`);

  step("Generating valve state changes (Solar Farm)");
  const solarValveEvents = generateSolarValveEvents();
  await insertStateChanges(solarValveEvents);
  ok(`${solarValveEvents.length} solar valve state changes`);

  // --- Commands ---
  await insertCommands();

  // --- Update current control states ---
  step("Setting current control states");
  const controls = [
    { eui: DEVICES.waterMonitor.eui, key: "pump",  state: "off", by: "RULE" },
    { eui: DEVICES.waterMonitor.eui, key: "valve", state: "closed", by: "RULE" },
    { eui: DEVICES.solarFarm.eui,    key: "valve", state: "closed", by: "RULE" },
  ];
  for (const c of controls) {
    try {
      const rec = await pb.collection("device_controls").getFirstListItem(
        `device_eui = "${c.eui}" && control_key = "${c.key}"`
      );
      await pb.collection("device_controls").update(rec.id, {
        current_state: c.state,
        last_change_by: c.by,
        last_change_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
      ok(`${c.key} → ${c.state} (${c.eui.slice(-4)})`);
    } catch {
      info(`  control ${c.key} not found for ${c.eui}, skipping`);
    }
  }

  const total = pumpEvents.length + valveEvents.length + solarValveEvents.length;
  info("");
  ok(`Done! ${total} state changes + 9 commands inserted.`);
}

main().catch(e => { err(e.message); process.exit(1); });
