// Logo implementation file
// Defines the extern variables to avoid multiple definitions

#include "logo.h"

// Array of all bitmaps for convenience. (Total bytes used to store images in PROGMEM = 528)
const int farmallArray_LEN = 1;
const unsigned char* farmallArray[1] = {
	logo_bits
};
