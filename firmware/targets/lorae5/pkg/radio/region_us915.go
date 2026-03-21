//go:build !lorae5_eu868 && !lorae5_au915

package radio

import "tinygo.org/x/drivers/lora/lorawan/region"

func regionSettings(_ string) region.Settings {
	return region.US915()
}
