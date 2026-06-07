The SX1302 HAT requires SPI to be enabled. On your Raspberry Pi:
1. Enable SPI:
sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/firmware/config.txt
# Or for older Pi OS:
# sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/config.txt

sudo raspi-config
Navigate to: Interface Options → SPI → Enable