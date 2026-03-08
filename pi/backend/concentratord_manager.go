package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/kisinga/farmon/pi/internal/gateway"
)

const (
	DefaultConcentratordBinPath    = "/usr/local/bin/chirpstack-concentratord-sx1302"
	DefaultConcentratordConfigPath = "pb_data/concentratord.toml"
	gatewayModel                  = "waveshare_sx1302_lorawan_gateway_hat"
)

// writeConcentratordTOML writes concentratord.toml from cfg (region, event_url, command_url).
// Same structure as setup_gateway.sh for EU868 and US915.
func writeConcentratordTOML(cfg gateway.Config, configPath string) error {
	region := strings.ToUpper(strings.TrimSpace(cfg.Region))
	if region == "" {
		region = gateway.DefaultRegion
	}
	eventURL := strings.TrimSpace(cfg.EventURL)
	if eventURL == "" {
		eventURL = gateway.DefaultEventURL
	}
	commandURL := strings.TrimSpace(cfg.CommandURL)
	if commandURL == "" {
		commandURL = gateway.DefaultCommandURL
	}

	var regionBlock string
	switch region {
	case "EU868":
		regionBlock = `multi_sf_channels = [
  868100000, 868300000, 868500000,
  867100000, 867300000, 867500000, 867700000, 867900000,
]

[gateway.concentrator.lora_std]
frequency = 868300000
bandwidth = 125000
spreading_factor = 7

[gateway.concentrator.fsk]
frequency = 0
bandwidth = 0
datarate = 0

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 868300000
rssi_offset = -215.4
tx_enable = true
tx_freq_min = 863000000
tx_freq_max = 870000000

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 868500000
rssi_offset = -215.4
tx_enable = false
`
	case "US915":
		regionBlock = `multi_sf_channels = [
  903900000, 904100000, 904300000, 904500000,
  904700000, 904900000, 905100000, 905300000,
]

# lora_std within radios (904.6); 923 MHz would panic this HAT
[gateway.concentrator.lora_std]
frequency = 904600000
bandwidth = 500000
spreading_factor = 8

[gateway.concentrator.fsk]
frequency = 0
bandwidth = 0
datarate = 0

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 904300000
rssi_offset = -215.4
tx_enable = true
tx_freq_min = 902000000
tx_freq_max = 928000000

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 905300000
rssi_offset = -215.4
tx_enable = false
`
	default:
		// Fallback to US915
		regionBlock = `multi_sf_channels = [
  903900000, 904100000, 904300000, 904500000,
  904700000, 904900000, 905100000, 905300000,
]

[gateway.concentrator.lora_std]
frequency = 904600000
bandwidth = 500000
spreading_factor = 8

[gateway.concentrator.fsk]
frequency = 0
bandwidth = 0
datarate = 0

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 904300000
rssi_offset = -215.4
tx_enable = true
tx_freq_min = 902000000
tx_freq_max = 928000000

[[gateway.concentrator.radios]]
enabled = true
type = "SX1250"
freq = 905300000
rssi_offset = -215.4
tx_enable = false
`
	}

	common := fmt.Sprintf(`[concentratord]
log_level = "INFO"
log_to_syslog = false
stats_interval = "30s"

api.event_bind = %q
api.command_bind = %q

[gateway]
lorawan_public = true
model = %q
region = %q
model_flags = []
time_fallback_enabled = true

[gateway.concentrator]
%s
[gateway.com_dev]
device = "/dev/spidev0.0"

[gateway.i2c_dev]
device = "/dev/i2c-1"
temp_sensor_addr = 57

[gateway.sx130x_reset]
reset_chip = "/dev/gpiochip0"
reset_pin = 23
power_en_chip = "/dev/gpiochip0"
power_en_pin = 18
`, eventURL, commandURL, gatewayModel, region, regionBlock)

	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir concentratord config dir: %w", err)
	}
	return os.WriteFile(configPath, []byte(common), 0644)
}

// concentratordProcess runs and stops the concentratord subprocess when manage_concentratord is true.
type concentratordProcess struct {
	mu   sync.Mutex
	cmd  *exec.Cmd
	path string
}

func (p *concentratordProcess) stop() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	err := p.cmd.Process.Kill()
	p.cmd = nil
	return err
}

func (p *concentratordProcess) start(binPath, configPath string) error {
	p.mu.Lock()
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
		p.cmd = nil
	}
	p.mu.Unlock()

	cmd := exec.Command(binPath, "-c", configPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start concentratord: %w", err)
	}
	p.mu.Lock()
	p.cmd = cmd
	p.path = configPath
	p.mu.Unlock()
	go func() {
		_ = cmd.Wait()
	}()
	return nil
}
