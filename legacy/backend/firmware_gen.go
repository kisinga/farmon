package main

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"

	"github.com/kisinga/farmon/firmware/pkg/catalog"
)

// driverGenInfo holds the code generation data for a single driver.
type driverGenInfo struct {
	Driver           catalog.DriverDef
	RegistrationCode string
	TinyGoImport     string // empty if custom driver
}

// genDriversGo generates the registerDrivers() function source code
// for a given set of driver IDs and build tag.
func genDriversGo(buildTag string, driverIDs []string) (string, error) {
	infos, err := resolveDrivers(driverIDs)
	if err != nil {
		return "", err
	}

	data := struct {
		BuildTag string
		Imports  []string
		Drivers  []driverGenInfo
	}{
		BuildTag: buildTag,
		Imports:  collectImports(infos),
		Drivers:  infos,
	}

	return renderTemplate(driversTemplate, "drivers", data)
}

// genConfigGo generates the defaultConfig() function source code
// with device-specific credentials.
func genConfigGo(buildTag string, cfg deviceConfigData) (string, error) {
	var tmpl string
	switch buildTag {
	case "stm32wlx":
		tmpl = configTemplateLoRaE5
	case "esp32s3":
		tmpl = configTemplateESP32S3
	default:
		tmpl = configTemplateRP2040
	}
	return renderTemplate(tmpl, "config", struct {
		BuildTag string
		Config   deviceConfigData
	}{buildTag, cfg})
}

// deviceConfigData holds credentials injected at build time.
type deviceConfigData struct {
	// WiFi (RP2040)
	WiFiSSID     string
	WiFiPassword string
	BackendHost  string
	BackendPort  string
	BackendPath  string
	DeviceToken  string
	// LoRaWAN (LoRa-E5)
	AppKeyBytes string // comma-separated byte literals: "0x01, 0x02, ..."
	Region      uint8
	SubBand     uint8
}

// resolveDrivers maps driver IDs to generation info with registration code.
func resolveDrivers(driverIDs []string) ([]driverGenInfo, error) {
	var infos []driverGenInfo
	for _, id := range driverIDs {
		d := catalog.DriverByID(id)
		if d == nil {
			return nil, fmt.Errorf("unknown driver: %s", id)
		}
		if d.Status != catalog.DriverReady {
			return nil, fmt.Errorf("driver %s is deferred, not ready", id)
		}
		info := driverGenInfo{
			Driver:           *d,
			RegistrationCode: registrationCodeFor(*d),
			TinyGoImport:     d.TinyGoPackage,
		}
		infos = append(infos, info)
	}
	return infos, nil
}

func collectImports(infos []driverGenInfo) []string {
	seen := make(map[string]bool)
	var imports []string
	for _, info := range infos {
		if info.TinyGoImport != "" && !seen[info.TinyGoImport] {
			seen[info.TinyGoImport] = true
			imports = append(imports, info.TinyGoImport)
		}
	}
	return imports
}

// registrationCodeFor generates the sensors.Register() call for a driver.
func registrationCodeFor(d catalog.DriverDef) string {
	sensorConst := sensorTypeConst(d.SensorType)

	if d.CustomDriver {
		return customDriverRegistration(d, sensorConst)
	}
	return tinygoDriverRegistration(d, sensorConst)
}

func customDriverRegistration(d catalog.DriverDef, sensorConst string) string {
	// Custom drivers use existing constructor functions in firmware/pkg/sensors/
	switch d.ID {
	case "adc_linear":
		return fmt.Sprintf(`sensors.Register(settings.%s, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewADCLinearSensor(boardPins[slot.PinIndex], slot.FieldIndex, slot.Param1, slot.Param2)
	})`, sensorConst)
	case "adc_4_20ma":
		return fmt.Sprintf(`sensors.Register(settings.%s, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewADC4_20mASensor(boardPins[slot.PinIndex], slot.FieldIndex, slot.Param1, slot.Param2)
	})`, sensorConst)
	case "digital_in":
		return fmt.Sprintf(`sensors.Register(settings.%s, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewDigitalInSensor(boardPins[slot.PinIndex], slot.FieldIndex, slot.Param1)
	})`, sensorConst)
	case "pulse_generic":
		return fmt.Sprintf(`sensors.Register(settings.%s, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		ppu := slot.Param1
		if ppu == 0 { ppu = 1 }
		return sensors.NewPulseGenericSensor(boardPins[slot.PinIndex], slot.FieldIndex, ppu)
	})`, sensorConst)
	case "modbus_rtu":
		return fmt.Sprintf(`sensors.Register(settings.%s, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		busIdx := int(slot.PinIndex)
		if busIdx >= 2 || b.UART[busIdx] == nil { return nil }
		devAddr := uint8(slot.Param1 & 0xFF)
		funcCode := uint8(slot.Param1 >> 8)
		if funcCode == 0 { funcCode = 0x03 }
		dePin, hasDEPin := b.RS485DEPin(busIdx)
		signed := slot.Flags&0x04 != 0
		return sensors.NewModbusRTUDriver(b.UART[busIdx], dePin, hasDEPin,
			devAddr, funcCode, slot.Param2, signed, slot.FieldIndex)
	})`, sensorConst)
	case "ds18b20":
		return fmt.Sprintf(`sensors.Register(settings.%s, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		return sensors.NewDS18B20Sensor(boardPins[slot.PinIndex], slot.FieldIndex)
	})`, sensorConst)
	case "bme280":
		return i2cDriverRegistration(sensorConst, "NewBME280Sensor", 0x76)
	case "ina219":
		return i2cDriverRegistration(sensorConst, "NewINA219Sensor", 0x40)
	default:
		return fmt.Sprintf("// TODO: custom driver registration for %s", d.ID)
	}
}

func tinygoDriverRegistration(d catalog.DriverDef, sensorConst string) string {
	if d.IOType == catalog.IOTypeI2C {
		constructorName := "New" + strings.ReplaceAll(strings.ToUpper(d.ID[:1])+d.ID[1:], "_", "") + "Sensor"
		return i2cDriverRegistration(sensorConst, constructorName, d.DefaultI2CAddr)
	}
	return fmt.Sprintf("// TODO: tinygo driver registration for %s (%s)", d.ID, d.IOType)
}

func i2cDriverRegistration(sensorConst, constructor string, defaultAddr uint8) string {
	return fmt.Sprintf(`sensors.Register(settings.%s, func(slot settings.SensorSlot, b *sensors.BusRegistry) sensors.Driver {
		busIdx := int(slot.PinIndex)
		if busIdx >= 2 || b.I2C[busIdx] == nil { return nil }
		addr := uint8(slot.Param1 & 0xFF)
		if addr == 0 { addr = 0x%02X }
		return sensors.%s(b.I2C[busIdx], addr, slot.FieldIndex)
	})`, sensorConst, defaultAddr, constructor)
}

func sensorTypeConst(st uint8) string {
	// Map sensor type values to Go const names
	names := map[uint8]string{
		1: "SensorFlowYFS201", 2: "SensorBatteryADC", 3: "SensorDS18B20",
		4: "SensorSoilADC", 5: "SensorBME280", 6: "SensorINA219",
		7: "SensorADCLinear", 8: "SensorADC4_20mA", 9: "SensorPulseGeneric",
		10: "SensorModbusRTU", 11: "SensorDigitalIn",
		12: "SensorSHT3x", 13: "SensorSHT4x", 14: "SensorBMP280",
		15: "SensorBMP388", 16: "SensorBH1750", 17: "SensorAHT20",
		18: "SensorTMP102", 19: "SensorMCP9808", 20: "SensorINA260",
		21: "SensorADT7410",
	}
	if name, ok := names[st]; ok {
		return name
	}
	return fmt.Sprintf("SensorType(%d)", st)
}

func renderTemplate(tmpl, name string, data any) (string, error) {
	t, err := template.New(name).Parse(tmpl)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

const driversTemplate = `//go:build {{.BuildTag}}

// Code generated by FarMon backend. DO NOT EDIT.
package main
{{if .Drivers}}
import (
	"github.com/kisinga/farmon/firmware/pkg/sensors"
	"github.com/kisinga/farmon/firmware/pkg/settings"
{{- range .Imports}}
	_ "{{.}}"
{{- end}}
)
{{end}}
func registerDrivers() {
{{- range .Drivers}}
	{{.RegistrationCode}}
{{- end}}
}
`

const configTemplateRP2040 = `//go:build {{.BuildTag}}

// Code generated by FarMon backend. DO NOT EDIT.
package main

func defaultConfig() rp2040Config {
	cfg := baseConfig()
	copy(cfg.WiFi.SSID[:], "{{.Config.WiFiSSID}}")
	copy(cfg.WiFi.Password[:], "{{.Config.WiFiPassword}}")
	copy(cfg.WiFi.BackendHost[:], "{{.Config.BackendHost}}")
	copy(cfg.WiFi.BackendPort[:], "{{.Config.BackendPort}}")
	copy(cfg.WiFi.BackendPath[:], "{{.Config.BackendPath}}")
	copy(cfg.WiFi.DeviceToken[:], "{{.Config.DeviceToken}}")
	return cfg
}
`

const configTemplateLoRaE5 = `//go:build {{.BuildTag}}

// Code generated by FarMon backend. DO NOT EDIT.
package main

// LoRa-E5 config is handled by initDefaults() in codec.go.
// This file is a placeholder required by the build system.
`

const configTemplateESP32S3 = `//go:build {{.BuildTag}}

// Code generated by FarMon backend. DO NOT EDIT.
package main

// ESP32-S3 (Heltec V3) config is handled by initDefaults() in codec.go.
// This file is a placeholder required by the build system.
`
