#pragma once

class RemoteApplicationImpl; // Forward declaration for the PIMPL pattern

class RemoteApplication {
public:
    RemoteApplication();
    ~RemoteApplication();

    void initialize();
    void run();

private:
    RemoteApplicationImpl* impl;
};
