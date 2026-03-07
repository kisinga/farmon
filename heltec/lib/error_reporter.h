#pragma once

#include <stdint.h>

// =============================================================================
// Error reporting interface — lib modules report errors without depending on app
// =============================================================================
// App implements IErrorReporter and injects it into radio_task, OTA, etc.
// reportError(category, subCode) maps to the correct telemetry counter.
// All counters reset daily; app persists with keys ec_na, ec_jf, ec_sr, etc.
// =============================================================================

namespace ErrorReporter {

enum class Category : uint8_t {
    Comm = 0,  // na, jf, sf
    Hw,        // sr, dr, dp
    Ota,       // cs, wf, tm
    Sys,       // mm, qf, ts
    Logic      // rf, cv, pf
};

// Sub-codes per category (map to single counter per sub-code)
namespace Comm { enum : uint8_t { NoAck = 0, JoinFail = 1, SendFail = 2 }; }
namespace Hw   { enum : uint8_t { SensorRead = 0, Driver = 1, Display = 2 }; }
namespace Ota  { enum : uint8_t { Crc = 0, Write = 1, Timeout = 2 }; }
namespace Sys  { enum : uint8_t { Memory = 0, QueueFull = 1, Task = 2 }; }
namespace Logic{ enum : uint8_t { Rule = 0, Config = 1, Persistence = 2 }; }

class IErrorReporter {
public:
    virtual ~IErrorReporter() = default;
    /** Report one occurrence of an error. App increments the corresponding counter and sets persist flag. */
    virtual void reportError(Category cat, uint8_t subCode) = 0;
};

} // namespace ErrorReporter
