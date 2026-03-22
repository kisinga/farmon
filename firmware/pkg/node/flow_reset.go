//go:build !esp32s3

package node

import "github.com/kisinga/farmon/firmware/pkg/sensors"

func resetFlowCounters(drivers []sensors.Driver) {
	for _, s := range drivers {
		if fs, ok := s.(*sensors.FlowSensor); ok {
			fs.SetTotalPulses(0)
		}
	}
}
