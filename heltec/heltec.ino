#include "remote_app.h"

RemoteApplication remoteApp;

void setup() {
    remoteApp.initialize();
}

void loop() {
    remoteApp.run();
}
