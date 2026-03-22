.PHONY: lorae5 lorae5-dev lorae5-flash lorae5-size lorae5-monitor rp2040 rp2040-flash rp2040-size rp2040-provision heltec heltec-flash heltec-size

# ─── LoRa-E5 (STM32WL) ───────────────────────────────────────────────────────

LORAE5_ENTRY     = ./targets/lorae5/cmd/node
LORAE5_COMMON    = -target=lorae5 -opt=z -gc=leaking -scheduler=none -size=short

# Minimal build — specify only the drivers you need via LORAE5_TAGS.
# Example: make lorae5 LORAE5_TAGS=farmon_bme280,farmon_ds18b20
LORAE5_TAGS     ?=
LORAE5_FLAGS     = $(LORAE5_COMMON) $(if $(LORAE5_TAGS),-tags=$(LORAE5_TAGS),)

# Dev build — includes ALL drivers (may overflow flash, use for RP2040 or size checks).
LORAE5_DEV_FLAGS = $(LORAE5_COMMON) -tags=farmon_all

lorae5:
	tinygo build $(LORAE5_FLAGS) -o build/lorae5.elf $(LORAE5_ENTRY)

lorae5-dev:
	tinygo build $(LORAE5_DEV_FLAGS) -o build/lorae5.elf $(LORAE5_ENTRY)

lorae5-flash:
	tinygo flash $(LORAE5_FLAGS) $(LORAE5_ENTRY)

lorae5-size:
	tinygo size $(LORAE5_FLAGS) $(LORAE5_ENTRY)

lorae5-monitor:
	screen $(PORT) 115200

# ─── RP2040 (Pico W) ─────────────────────────────────────────────────────────

RP2040_ENTRY  = ./targets/rp2040/cmd/node
RP2040_FLAGS  = -target=pico-w -opt=z -size=short -tags=farmon_all

rp2040:
	tinygo build $(RP2040_FLAGS) -o build/rp2040.uf2 $(RP2040_ENTRY)

rp2040-flash:
	tinygo flash $(RP2040_FLAGS) $(RP2040_ENTRY)

rp2040-size:
	tinygo size $(RP2040_FLAGS) $(RP2040_ENTRY)

# Provision WiFi credentials onto RP2040 flash before first boot.
# Usage: make rp2040-provision SSID=MyNet PASS=secret TOKEN=abc URL=http://server:8090/api/farmon/ingest
rp2040-provision:
	go run ./tools/provision -target=rp2040 -ssid=$(SSID) -pass=$(PASS) -token=$(TOKEN) -url=$(URL)

# ─── Heltec WiFi LoRa 32 V3 (ESP32-S3) — experimental ──────────────────────

HELTEC_ENTRY  = ./targets/heltec_v3/cmd/node
HELTEC_TAGS  ?=
HELTEC_FLAGS  = -target=esp32s3 -opt=z -size=short $(if $(HELTEC_TAGS),-tags=$(HELTEC_TAGS),)

heltec:
	tinygo build $(HELTEC_FLAGS) -o build/heltec_v3.bin $(HELTEC_ENTRY)

heltec-flash:
	tinygo flash $(HELTEC_FLAGS) $(HELTEC_ENTRY)

heltec-size:
	tinygo size $(HELTEC_FLAGS) $(HELTEC_ENTRY)
