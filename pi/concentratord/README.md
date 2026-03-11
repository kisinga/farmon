# Concentratord config (EU868 / US915)

## THE FLOW (what sets what)

1. **You run `setup_gateway.sh`**  
   - Installs the concentratord binary.  
   - Copies 4 TOML files to `/etc/chirpstack-concentratord/`.  
   - **Does not start concentratord. Does not choose a region.** Only files on disk.

2. **You start concentratord** (by hand or via systemd)  
   - You must run it with **one** of these:
     - **EU868:** `chirpstack-concentratord-sx1302 -c /etc/chirpstack-concentratord/concentratord_eu868.toml -c /etc/chirpstack-concentratord/channels_eu868.toml`
     - **US915:** `chirpstack-concentratord-sx1302 -c /etc/chirpstack-concentratord/concentratord.toml -c /etc/chirpstack-concentratord/channels_us915.toml`
   - **The config that is “set” = the one you pass with `-c`.** No default. If you use a systemd unit, whatever `-c` arguments are in that unit are what’s set.

3. **You set Gateway in the app**  
   - Event URL, Command URL, **Region** (EU868 or US915) → Save.  
   - Region in the app must match the config you used to start concentratord.

So: **region is set only when you start concentratord** (by the config files you pass). The script never sets it.

---

## Config sets (pick one)

| HAT band | Main config              | Channels config        | lora_std (downlink) |
|----------|--------------------------|------------------------|----------------------|
| **868 MHz (EU868)** | `concentratord_eu868.toml` | `channels_eu868.toml` | 868.1 MHz            |
| **915 MHz (US915)** | `concentratord.toml`       | `channels_us915.toml` | 923.3 MHz            |

**Why lora_std matters:** The concentratord **lora_std** channel is used for Class A downlink (e.g. JoinAccept). If it’s wrong, the device never gets the response.

After changing config, restart concentratord so it reloads the files.

---

## Root cause of `Failed to set SX1250_0 in STANDBY_RC mode`

This error means the SX1302 chip was detected (SPI works, chip version printed) but the
SX1250 RF frontend couldn't be initialized. Almost always a power issue on GPIO 18 (PWREN):

1. **GPIO 18 held by a crashed previous instance** — the most common cause after a restart loop.
   Fixed by the `ExecStartPre` GPIO release in the systemd service. Re-run `setup_gateway.sh`
   (or `systemctl daemon-reload && systemctl restart chirpstack-concentratord`) to pick up the new service.

2. **GPIO 18 claimed by a kernel driver at boot** — check:
   ```bash
   gpioinfo | grep -E '"17"|"18"'   # both must show "unused" before concentratord starts
   grep -E "pwm|i2s|uart" /boot/firmware/config.txt
   ```
   Remove any overlay that claims GPIO 18 (e.g. `dtoverlay=pwm`), then reboot.

3. **Restart loop masking the error** — with hundreds of restarts, EBUSY appears on every
   attempt after the first, hiding the original failure. Fix the EBUSY cascade first (see below),
   then check whether `lgw_start` still fails in a clean restart.

---

## Root cause of `EBUSY: Device or resource busy` on reset pin

The **reference config** (matching the working ChirpStack setup) uses **GPIO 23** for SX1302 reset and **GPIO 18** for power-enable. On Raspberry Pi, **GPIO 23 is SD0 CMD** (part of the sdhost/secondary SD interface). On many Pi OS/kernel setups the kernel or a driver **claims this line**, so when concentratord requests it via libgpiod, the ioctl returns **EBUSY** and the daemon exits. Systemd then restarts it in a loop.

**Mitigation:** If you get EBUSY with pin 23, set `sx1302_reset_pin = 17` in the TOML (and ensure no other process uses GPIO 17). The Waveshare SX1302 LoRaWAN Gateway HAT schematic uses GPIO 17 for reset on some boards. If both 23 and 17 are busy, run `gpioinfo` or check `/boot/config.txt` / device tree to see what is claiming the pins; free the chosen pin or use another per your HAT schematic.

After copying the updated config to the Pi (e.g. re-run `setup_gateway.sh` or copy `pi/concentratord/*.toml` to `/etc/chirpstack-concentratord/`), restart concentratord.
