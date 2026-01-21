#pragma once

#include <Arduino.h>
#include <functional>
#include <string>
#include <vector>
#include <freertos/FreeRTOS.h>
#include <freertos/timers.h>

template<typename TState>
using RtosTaskCallback = std::function<void(TState&)>;

template<typename TState>
class RtosTaskManager {
public:
    explicit RtosTaskManager(uint32_t defaultTaskStackSize = 2048)
        : _running(false), _state(nullptr) {}

    ~RtosTaskManager() {
        for (auto& task : _tasks) {
            if (task.timerHandle) {
                xTimerDelete(task.timerHandle, portMAX_DELAY);
            }
        }
    }

    bool addTask(const std::string& name, RtosTaskCallback<TState> callback, uint32_t intervalMs) {
        if (_running) {
            return false;
        }
        _tasks.emplace_back(TaskData{name, callback, intervalMs, nullptr});
        return true;
    }

    void start(TState& initialState) {
        if (_running) {
            return;
        }
        _state = &initialState;
        _running = true;

        // Ensure the contexts vector doesn't reallocate, which would invalidate pointers.
        _timerContexts.reserve(_tasks.size());

        for (auto& task : _tasks) {
            // Create a persistent context for each timer.
            _timerContexts.emplace_back(TimerContext{this, &task});
            TimerContext* context = &_timerContexts.back();

            task.timerHandle = xTimerCreate(
                task.name.c_str(),
                pdMS_TO_TICKS(task.intervalMs),
                pdTRUE, // Auto-reload timer
                (void*)context, // Pass the context pointer as the timer ID
                timerCallback
            );

            if (task.timerHandle) {
                xTimerStart(task.timerHandle, 0);
            }
        }
    }

private:
    struct TaskData {
        std::string name;
        RtosTaskCallback<TState> callback;
        uint32_t intervalMs;
        TimerHandle_t timerHandle;
    };

    // A dedicated context struct to safely pass state to the static C callback.
    struct TimerContext {
        RtosTaskManager<TState>* manager;
        TaskData* task;
    };

    static void timerCallback(TimerHandle_t xTimer) {
        TimerContext* context = (TimerContext*)pvTimerGetTimerID(xTimer);
        if (context && context->task && context->task->callback && context->manager && context->manager->_state) {
            context->manager->_state->nowMs = millis();
            context->task->callback(*context->manager->_state);
        }
    }

    std::vector<TaskData> _tasks;
    std::vector<TimerContext> _timerContexts; // Owns the context objects
    bool _running;
    TState* _state;
};
