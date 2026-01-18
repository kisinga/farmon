#pragma once

#include <stdint.h>
#include <string>

class IPersistenceHal {
public:
    virtual ~IPersistenceHal() = default;

    virtual bool begin(const char* namespace_name) = 0;
    virtual void end() = 0;
    virtual bool saveU32(const char* key, uint32_t value) = 0;
    virtual uint32_t loadU32(const char* key, uint32_t defaultValue = 0) = 0;
    virtual bool saveFloat(const char* key, float value) = 0;
    virtual float loadFloat(const char* key, float defaultValue = 0.0f) = 0;
    virtual bool saveString(const char* key, const std::string& value) = 0;
    virtual std::string loadString(const char* key, const std::string& defaultValue = "") = 0;
};

#include <Preferences.h>

class FlashPersistenceHal : public IPersistenceHal {
public:
    FlashPersistenceHal() = default;

    bool begin(const char* namespace_name) override {
        return preferences.begin(namespace_name, false); // false = not read-only
    }

    void end() override {
        preferences.end();
    }

    bool saveU32(const char* key, uint32_t value) override {
        return preferences.putUInt(key, value) > 0;
    }

    uint32_t loadU32(const char* key, uint32_t defaultValue = 0) override {
        return preferences.getUInt(key, defaultValue);
    }

    bool saveFloat(const char* key, float value) override {
        return preferences.putFloat(key, value) > 0;
    }

    float loadFloat(const char* key, float defaultValue = 0.0f) override {
        return preferences.getFloat(key, defaultValue);
    }

    bool saveString(const char* key, const std::string& value) override {
        return preferences.putString(key, value.c_str()) > 0;
    }

    std::string loadString(const char* key, const std::string& defaultValue = "") override {
        return preferences.getString(key, defaultValue.c_str()).c_str();
    }

private:
    Preferences preferences;
};
