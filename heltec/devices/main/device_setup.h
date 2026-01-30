// Device setup: sensor and control wiring for main.
// Requires SensorManager, RemoteSensorConfig, IBatteryHal, IPersistenceHal,
// SensorFactory, YFS201WaterFlowSensor, EdgeRulesEngine, NoOpControlDriver (included by remote_app.cpp before this).

#ifndef DEVICES_MAIN_DEVICE_SETUP_H
#define DEVICES_MAIN_DEVICE_SETUP_H

inline void setupDeviceSensors(
    SensorManager& mgr,
    const RemoteSensorConfig& cfg,
    IBatteryHal* batteryHal,
    IPersistenceHal* persistenceHal,
    std::shared_ptr<YFS201WaterFlowSensor>* outWaterFlow
) {
    if (!cfg.enableSensorSystem) return;

    // Add in schema field order (pd, tv, bp) so readAll() matches rule evaluation indices
    auto waterFlow = SensorFactory::createYFS201WaterFlowSensor(cfg.waterFlow, persistenceHal);
    mgr.addSensor(waterFlow);
    if (outWaterFlow) *outWaterFlow = waterFlow;

    auto batterySensor = SensorFactory::createBatteryMonitorSensor(batteryHal, cfg.battery);
    mgr.addSensor(batterySensor);
}

inline void registerDeviceControls(EdgeRules::EdgeRulesEngine& engine) {
    static NoOpControlDriver pumpDriver("Pump");
    static NoOpControlDriver valveDriver("Valve");
    engine.registerControl(0, &pumpDriver);
    engine.registerControl(1, &valveDriver);
}

#endif // DEVICES_MAIN_DEVICE_SETUP_H
