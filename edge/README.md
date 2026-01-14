# Edge

Farm site devices and services.

| Folder    | Description                                      |
| --------- | ------------------------------------------------ |
| `pi/`     | Raspberry Pi: ChirpStack, Docker stack, setup    |
| `heltec/` | Heltec LoRaWAN node firmware for field sensors   |

All Heltec nodes communicate via LoRaWAN to the SX1302 gateway, which forwards packets to ChirpStack on the Pi.
