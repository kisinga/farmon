#pragma once

#include <Arduino.h>
#include <functional>
#include <string>
#include <vector>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/timers.h>

template<typename TState>
using RtosTaskCallback = std::function<void(TState&)>;

template<typename TState>
class RtosTaskManager {
public:
    explicit RtosTaskManager(uint32_t defaultTaskStackSize = 2048)
        : _running(false), _state(nullptr), _defaultStackSize(defaultTaskStackSize) {}

    ~RtosTaskManager() {
        for (auto& task : _tasks) {
            if (task.timerHandle) {
                xTimerDelete(task.timerHandle, portMAX_DELAY);
            }
        }
        for (auto& bt : _blockingTasks) {
            if (bt.taskHandle) {
                vTaskDelete(bt.taskHandle);
            }
        }
        for (auto* ctx : _blockingContexts) {
            delete ctx;
        }
    }

    bool addTask(const std::string& name, RtosTaskCallback<TState> callback, uint32_t intervalMs) {
        if (_running) {
            return false;
        }
        _tasks.emplace_back(TaskData{name, callback, intervalMs, nullptr});
        return true;
    }

    bool addBlockingTask(const std::string& name, RtosTaskCallback<TState> callback, uint32_t intervalMs) {
        if (_running) {
            return false;
        }
        _blockingTasks.emplace_back(BlockingTaskData{name, callback, intervalMs, nullptr});
        return true;
    }

    bool setTaskInterval(const std::string& name, uint32_t newIntervalMs) {
        for (auto& task : _tasks) {
            if (task.name == name && task.timerHandle) {
                task.intervalMs = newIntervalMs;
                return xTimerChangePeriod(task.timerHandle,
                    pdMS_TO_TICKS(newIntervalMs), portMAX_DELAY) == pdPASS;
            }
        }
        return false;
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

        for (auto& bt : _blockingTasks) {
            BlockingTaskContext* ctx = new BlockingTaskContext{this, &bt};
            _blockingContexts.push_back(ctx);
            BaseType_t ok = xTaskCreate(
                blockingTaskEntry,
                bt.name.c_str(),
                _defaultStackSize,
                ctx,
                1,
                &bt.taskHandle
            );
            if (ok != pdPASS) {
                bt.taskHandle = nullptr;
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

    struct BlockingTaskData {
        std::string name;
        RtosTaskCallback<TState> callback;
        uint32_t intervalMs;
        TaskHandle_t taskHandle;
    };

    struct BlockingTaskContext {
        RtosTaskManager<TState>* manager;
        BlockingTaskData* task;
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

    static void blockingTaskEntry(void* param) {
        BlockingTaskContext* ctx = (BlockingTaskContext*)param;
        if (!ctx || !ctx->manager || !ctx->task) return;
        RtosTaskManager* mgr = ctx->manager;
        BlockingTaskData* bt = ctx->task;
        TState* state = mgr->_state;
        if (!state || !bt->callback) return;
        for (;;) {
            state->nowMs = millis();
            bt->callback(*state);
            vTaskDelay(pdMS_TO_TICKS(bt->intervalMs));
        }
    }

    std::vector<TaskData> _tasks;
    std::vector<BlockingTaskData> _blockingTasks;
    std::vector<TimerContext> _timerContexts; // Owns the context objects
    std::vector<BlockingTaskContext*> _blockingContexts; // Owns the context objects
    bool _running;
    TState* _state;
    uint32_t _defaultStackSize;
};
