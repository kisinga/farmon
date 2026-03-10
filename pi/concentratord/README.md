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

## Root cause of `EBUSY: Device or resource busy` on reset pin

ChirpStack concentratord’s **waveshare_sx1302_lorawan_gateway_hat** model uses the Lora-net HAL default **GPIO 23** for the SX1302 reset pin. On Raspberry Pi, **GPIO 23 is SD0 CMD** (part of the sdhost/secondary SD interface). On many Pi OS/kernel setups the kernel or a driver **claims this line**, so when concentratord requests it via libgpiod, the ioctl returns **EBUSY** and the daemon exits. Systemd then restarts it in a loop.

The **Waveshare SX1302 LoRaWAN Gateway HAT** uses **GPIO 17** for SX1302 reset (schematic and Waveshare’s custom HAL). GPIO 17 is not reserved for SD on the Pi, so using it avoids the conflict.

**Fix (already applied in this repo):** The concentratord TOML files set `sx1302_reset_chip = "/dev/gpiochip0"` and `sx1302_reset_pin = 17`. After copying the updated config to the Pi (e.g. re-run `setup_gateway.sh` or copy `pi/concentratord/*.toml` to `/etc/chirpstack-concentratord/`), restart concentratord. If your HAT actually uses a different reset pin (e.g. 23 on a different board), change `sx1302_reset_pin` in the TOML to match your hardware.
