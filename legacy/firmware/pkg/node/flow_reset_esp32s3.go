//go:build esp32s3

package node

import "github.com/kisinga/farmon/firmware/pkg/sensors"

func resetFlowCounters(_ []sensors.Driver) {}
