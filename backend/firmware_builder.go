package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kisinga/farmon/firmware/pkg/catalog"
	"github.com/pocketbase/pocketbase/core"
)

// FirmwareBuildRequest contains everything needed to build firmware for a device.
type FirmwareBuildRequest struct {
	DeviceEUI     string
	HardwareModel string // "rp2040" or "lorae5"
	DriverIDs     []string
	Credentials   deviceConfigData
}

// FirmwareBuildResult is returned after a build attempt.
type FirmwareBuildResult struct {
	BinaryPath string
	BinarySize int64
	Target     string // "pico-w" or "lorae5"
	BuildLog   string
	Success    bool
	Error      string
}

// buildFirmware generates device-specific firmware source code, compiles it
// with TinyGo, and returns the path to the compiled binary.
func buildFirmware(app core.App, req FirmwareBuildRequest) FirmwareBuildResult {
	target, ext, buildTag := targetInfo(req.HardwareModel)

	// Create build directory
	buildDir := filepath.Join("builds", req.DeviceEUI)
	if err := os.MkdirAll(buildDir, 0o755); err != nil {
		return failResult(fmt.Sprintf("mkdir: %v", err))
	}

	// Generate registerDrivers() code
	driversCode, err := genDriversGo(buildTag, req.DriverIDs)
	if err != nil {
		return failResult(fmt.Sprintf("gen drivers: %v", err))
	}
	if err := os.WriteFile(filepath.Join(buildDir, "generated_drivers.go"), []byte(driversCode), 0o644); err != nil {
		return failResult(fmt.Sprintf("write drivers: %v", err))
	}

	// Generate defaultConfig() with credentials
	configCode, err := genConfigGo(buildTag, req.Credentials)
	if err != nil {
		return failResult(fmt.Sprintf("gen config: %v", err))
	}
	if err := os.WriteFile(filepath.Join(buildDir, "generated_config.go"), []byte(configCode), 0o644); err != nil {
		return failResult(fmt.Sprintf("write config: %v", err))
	}

	// Determine firmware source dir relative to backend working directory
	fwRoot, err := findFirmwareRoot()
	if err != nil {
		return failResult(fmt.Sprintf("find firmware: %v", err))
	}

	// Create symlinks to firmware source tree
	targetSrcDir := filepath.Join(fwRoot, "targets", req.HardwareModel, "cmd", "node")
	if err := symlinkFirmwareFiles(targetSrcDir, buildDir, buildTag); err != nil {
		return failResult(fmt.Sprintf("symlink: %v", err))
	}

	// Symlink go.mod and go.sum
	for _, f := range []string{"go.mod", "go.sum"} {
		src := filepath.Join(fwRoot, f)
		dst := filepath.Join(buildDir, f)
		os.Remove(dst)
		if err := os.Symlink(src, dst); err != nil {
			return failResult(fmt.Sprintf("symlink %s: %v", f, err))
		}
	}

	// Symlink pkg directory
	pkgDst := filepath.Join(buildDir, "pkg")
	os.Remove(pkgDst)
	if err := os.Symlink(filepath.Join(fwRoot, "pkg"), pkgDst); err != nil {
		return failResult(fmt.Sprintf("symlink pkg: %v", err))
	}

	// Symlink targets directory
	targetsDst := filepath.Join(buildDir, "targets")
	os.Remove(targetsDst)
	if err := os.Symlink(filepath.Join(fwRoot, "targets"), targetsDst); err != nil {
		return failResult(fmt.Sprintf("symlink targets: %v", err))
	}

	// Build with TinyGo
	// outFile is the path from the backend's cwd; tinygo gets just the filename
	// since cmd.Dir is already set to buildDir.
	outFile := filepath.Join(buildDir, "firmware"+ext)
	outFileName := "firmware" + ext
	buildTags := driverBuildTags(req.DriverIDs)
	if rTag := regionBuildTag(req.Credentials.Region); rTag != "" {
		if buildTags != "" {
			buildTags += "," + rTag
		} else {
			buildTags = rTag
		}
	}
	gcFlag := "conservative"
	schedulerFlag := "tasks"
	if target == "lorae5" {
		gcFlag = "leaking"
		schedulerFlag = "none"
	}
	args := []string{"build",
		"-target=" + target,
		"-opt=z",
		"-gc=" + gcFlag,
		"-scheduler=" + schedulerFlag,
		"-size=short",
		"-o", outFileName,
	}
	if buildTags != "" {
		args = append(args, "-tags="+buildTags)
	}
	args = append(args, ".")
	cmd := exec.Command("tinygo", args...)
	cmd.Dir = buildDir
	// Disable workspace mode — build dir has its own go.mod via symlink
	cmd.Env = append(os.Environ(), "GOWORK=off")

	log.Printf("[firmware] building %s for %s (drivers: %v)", req.DeviceEUI, target, req.DriverIDs)
	start := time.Now()

	output, buildErr := cmd.CombinedOutput()
	buildLog := string(output)
	elapsed := time.Since(start)

	if buildErr != nil {
		log.Printf("[firmware] build FAILED for %s in %v: %s", req.DeviceEUI, elapsed, buildLog)
		return FirmwareBuildResult{
			BuildLog: buildLog,
			Target:   target,
			Error:    buildErr.Error(),
		}
	}

	stat, err := os.Stat(outFile)
	if err != nil {
		return failResult(fmt.Sprintf("stat output: %v", err))
	}

	log.Printf("[firmware] build OK for %s in %v (%d bytes)", req.DeviceEUI, elapsed, stat.Size())
	return FirmwareBuildResult{
		BinaryPath: outFile,
		BinarySize: stat.Size(),
		Target:     target,
		BuildLog:   buildLog,
		Success:    true,
	}
}

// deriveDriverIDs extracts the set of required driver IDs from a device's
// configured sensor slots in device_airconfig.
func deriveDriverIDs(app core.App, deviceEUI string) ([]string, error) {
	rec, err := app.FindFirstRecordByFilter("device_airconfig",
		"device_eui = {:eui}", map[string]any{"eui": deviceEUI})
	if err != nil {
		return nil, fmt.Errorf("no airconfig for %s: %w", deviceEUI, err)
	}

	sensorsRaw := rec.Get("sensors")
	sensors, ok := sensorsRaw.([]any)
	if !ok || len(sensors) == 0 {
		return nil, nil
	}

	seen := make(map[string]bool)
	var driverIDs []string
	for _, s := range sensors {
		sensorMap, ok := s.(map[string]any)
		if !ok {
			continue
		}
		st, ok := sensorMap["type"].(float64)
		if !ok {
			continue
		}
		d := catalog.DriverBySensorType(uint8(st))
		if d != nil && !seen[d.ID] {
			seen[d.ID] = true
			driverIDs = append(driverIDs, d.ID)
		}
	}
	return driverIDs, nil
}

func targetInfo(hwModel string) (target, ext, buildTag string) {
	switch hwModel {
	case "lorae5":
		return "lorae5", ".elf", "stm32wlx"
	default:
		return "pico-w", ".uf2", "rp2040"
	}
}

func findFirmwareRoot() (string, error) {
	// Try relative path from backend working directory
	candidates := []string{
		"../firmware",
		"firmware",
	}
	for _, c := range candidates {
		abs, _ := filepath.Abs(c)
		if _, err := os.Stat(filepath.Join(abs, "go.mod")); err == nil {
			return abs, nil
		}
	}
	return "", fmt.Errorf("firmware directory not found (tried: %v)", candidates)
}

// symlinkFirmwareFiles creates symlinks for the non-generated .go files
// from the target source directory into the build directory.
func symlinkFirmwareFiles(srcDir, buildDir, buildTag string) error {
	// Clean stale .go symlinks from previous builds
	existing, _ := os.ReadDir(buildDir)
	for _, e := range existing {
		name := e.Name()
		if strings.HasSuffix(name, ".go") && !strings.HasPrefix(name, "generated_") {
			os.Remove(filepath.Join(buildDir, name))
		}
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	// Files we generate ourselves — skip symlinks for these
	generated := map[string]bool{
		"generated_drivers.go": true,
		"generated_config.go":  true,
		"drivers.go":           true, // replaced by generated_drivers.go
		"drivers_none.go":      true, // replaced by generated_drivers.go
	}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || generated[name] {
			continue
		}
		// Skip the original registerDrivers/defaultConfig source —
		// these are replaced by generated code
		dst := filepath.Join(buildDir, name)
		os.Remove(dst)
		src, _ := filepath.Abs(filepath.Join(srcDir, name))
		if err := os.Symlink(src, dst); err != nil {
			return fmt.Errorf("symlink %s: %w", name, err)
		}
	}
	return nil
}

// driverBuildTags returns comma-separated build tags for the given driver IDs.
// Each sensor adapter file uses //go:build farmon_{id} || farmon_all.
func driverBuildTags(driverIDs []string) string {
	if len(driverIDs) == 0 {
		return ""
	}
	tags := make([]string, len(driverIDs))
	for i, id := range driverIDs {
		tags[i] = "farmon_" + id
	}
	return strings.Join(tags, ",")
}

// regionBuildTag returns the build tag for the LoRaWAN region.
// Default (US915) needs no tag; EU868 and AU915 use lorae5_eu868/lorae5_au915.
func regionBuildTag(regionCode uint8) string {
	switch regionCode {
	case 1:
		return "lorae5_eu868"
	case 2:
		return "lorae5_au915"
	default:
		return "" // US915 is the default (no tag needed)
	}
}

func failResult(msg string) FirmwareBuildResult {
	return FirmwareBuildResult{Error: msg, BuildLog: msg}
}
