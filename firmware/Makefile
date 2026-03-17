.PHONY: lorae5 lorae5-flash lorae5-size lorae5-monitor rp2040 rp2040-flash rp2040-size rp2040-provision

# ─── LoRa-E5 (STM32WL) ───────────────────────────────────────────────────────

LORAE5_ENTRY  = ./targets/lorae5/cmd/node
LORAE5_FLAGS  = -target=lorae5 -opt=z -size=short

lorae5:
	tinygo build $(LORAE5_FLAGS) -o build/lorae5.elf $(LORAE5_ENTRY)

lorae5-flash:
	tinygo flash $(LORAE5_FLAGS) $(LORAE5_ENTRY)

lorae5-size:
	tinygo size $(LORAE5_FLAGS) $(LORAE5_ENTRY)

lorae5-monitor:
	screen $(PORT) 115200

# ─── RP2040 (Pico W) ─────────────────────────────────────────────────────────

RP2040_ENTRY  = ./targets/rp2040/cmd/node
RP2040_FLAGS  = -target=pico-w -opt=z -size=short

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
