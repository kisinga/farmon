//go:build lorae5_au915

package radio

import "tinygo.org/x/drivers/lora/lorawan/region"

func regionSettings(_ string) region.Settings {
	return region.AU915()
}
