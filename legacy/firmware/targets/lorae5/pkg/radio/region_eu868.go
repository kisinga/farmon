//go:build lorae5_eu868

package radio

import "tinygo.org/x/drivers/lora/lorawan/region"

func regionSettings(_ string) region.Settings {
	return region.EU868()
}
