"""MajiFlow route control engine (maji_control).

Imperative shell around the pure control kernel (core.{h,cpp}). The route table and
all entity bindings (tank/flow sensors, valve covers, pump relays, per-route tunable
numbers, status globals) are config; the C++ snapshots them each tick, runs the kernel,
and applies the result. Decision logic lives in the kernel — this component is I/O.
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_NAME
from esphome.components import sensor, cover, switch, number

CODEOWNERS = ["@majiflow"]
DEPENDENCIES = ["maji_claims"]

maji_control_ns = cg.esphome_ns.namespace("maji_control")
MajiControl = maji_control_ns.class_("MajiControl", cg.Component)

maji_ctl_ns = cg.global_ns.namespace("maji_ctl")
RouteStruct = maji_ctl_ns.struct("Route")
ManualPumpStruct = maji_ctl_ns.struct("ManualPump")
RouteHandlesStruct = maji_control_ns.struct("RouteHandles")
ValveHandlesStruct = maji_control_ns.struct("ValveHandles")
FlowHandlesStruct = maji_control_ns.struct("FlowHandles")

MajiClaims = cg.esphome_ns.namespace("maji_claims").class_("MajiClaims")

# --- field names ---
CONF_CLAIMS_ID = "claims_id"
CONF_SAFETY_OVERRIDE_ID = "safety_override_id"
CONF_FLOW_WATCHDOG_ID = "flow_watchdog_id"
CONF_FLOW_CONFIRM_ID = "flow_confirm_id"
CONF_FLOW_THRESHOLD_ID = "flow_threshold_id"
CONF_DEFAULTS = "defaults"
CONF_TANKS = "tanks"
CONF_FLOWS = "flows"
CONF_VALVES = "valves"
CONF_PUMPS = "pumps"
CONF_ROUTES = "routes"
CONF_MANUAL_PUMPS = "manual_pumps"
CONF_SENSOR = "sensor"
CONF_RATE = "rate"
CONF_TOTAL = "total"
CONF_COVER = "cover"
CONF_TRAVEL_ID = "travel_id"

_DEFAULTS_SCHEMA = cv.Schema(
    {
        cv.Optional("flow_watchdog_ms", default=20000): cv.uint32_t,
        cv.Optional("flow_confirm_ms", default=3000): cv.uint32_t,
        cv.Optional("flow_threshold", default=1.0): cv.float_,
        cv.Optional("valve_travel_ms", default=15000): cv.uint32_t,
    }
)

# A tank slot is either {sensor: id} or {} (unmonitored -> null handle), idx order preserved.
_TANK_SCHEMA = cv.Schema({cv.Optional(CONF_SENSOR): cv.use_id(sensor.Sensor)})
_FLOW_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_RATE): cv.use_id(sensor.Sensor),
        cv.Optional(CONF_TOTAL): cv.use_id(sensor.Sensor),  # remote sensors have no total
    }
)
_VALVE_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_COVER): cv.use_id(cover.Cover),
        cv.Optional(CONF_TRAVEL_ID): cv.use_id(number.Number),
    }
)

_ROUTE_SCHEMA = cv.Schema(
    {
        cv.Required("id"): cv.uint8_t,
        cv.Required("valve_mask"): cv.uint16_t,
        cv.Optional("source_tank", default=0xFF): cv.uint8_t,
        cv.Optional("source_ws", default=0xFF): cv.uint8_t,
        cv.Optional("dest_tank", default=0xFF): cv.uint8_t,
        cv.Optional("flow_sensor", default=0xFF): cv.uint8_t,
        cv.Optional("conflict_mask", default=0): cv.uint16_t,
        cv.Optional("max_runtime_s", default=1800): cv.uint16_t,
        cv.Optional("pump_idx", default=0xFF): cv.uint8_t,
        cv.Optional("source_min_pct", default=0): cv.uint8_t,
        cv.Optional("dest_max_pct", default=0): cv.uint8_t,
        cv.Optional("runtime_level_ok", default=False): cv.boolean,
        cv.Optional(CONF_NAME, default=""): cv.string,
        # per-route tunable number handles (any may be absent)
        cv.Optional("max_runtime_id"): cv.use_id(number.Number),
        cv.Optional("target_duration_id"): cv.use_id(number.Number),
        cv.Optional("target_volume_id"): cv.use_id(number.Number),
        cv.Optional("source_min_id"): cv.use_id(number.Number),
        cv.Optional("dest_max_id"): cv.use_id(number.Number),
        cv.Optional("flow_stall_id"): cv.use_id(number.Number),
    }
)

_MANUAL_PUMP_SCHEMA = cv.Schema(
    {
        cv.Required("node_id"): cv.string_strict,
        cv.Required("relay_idx"): cv.uint8_t,
        cv.Optional("flow_mask", default=0): cv.uint16_t,
        cv.Optional("src_tank", default=0xFF): cv.uint8_t,
        cv.Optional("src_min", default=0): cv.uint8_t,
        cv.Optional("max_rt_ms", default=0): cv.uint32_t,
    }
)

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(MajiControl),
        cv.Required(CONF_CLAIMS_ID): cv.use_id(MajiClaims),
        cv.Required(CONF_SAFETY_OVERRIDE_ID): cv.use_id(switch.Switch),
        cv.Required(CONF_FLOW_WATCHDOG_ID): cv.use_id(number.Number),
        cv.Required(CONF_FLOW_CONFIRM_ID): cv.use_id(number.Number),
        cv.Required(CONF_FLOW_THRESHOLD_ID): cv.use_id(number.Number),
        cv.Optional(CONF_DEFAULTS, default={}): _DEFAULTS_SCHEMA,
        cv.Optional(CONF_TANKS, default=[]): cv.ensure_list(_TANK_SCHEMA),
        cv.Optional(CONF_FLOWS, default=[]): cv.ensure_list(_FLOW_SCHEMA),
        cv.Optional(CONF_VALVES, default=[]): cv.ensure_list(_VALVE_SCHEMA),
        cv.Optional(CONF_PUMPS, default=[]): cv.ensure_list(cv.use_id(switch.Switch)),
        cv.Optional(CONF_ROUTES, default=[]): cv.ensure_list(_ROUTE_SCHEMA),
        cv.Optional(CONF_MANUAL_PUMPS, default=[]): cv.ensure_list(_MANUAL_PUMP_SCHEMA),
    }
).extend(cv.COMPONENT_SCHEMA)


async def _opt_var(config, key):
    """get_variable for an optional use_id, or nullptr if absent."""
    if key in config:
        return await cg.get_variable(config[key])
    return cg.nullptr


def _route_struct(r):
    return cg.StructInitializer(
        RouteStruct,
        ("id", r["id"]),
        ("valve_mask", r["valve_mask"]),
        ("source_tank", r["source_tank"]),
        ("source_ws", r["source_ws"]),
        ("dest_tank", r["dest_tank"]),
        ("flow_sensor", r["flow_sensor"]),
        ("conflict_mask", r["conflict_mask"]),
        ("max_runtime_s", r["max_runtime_s"]),
        ("pump_idx", r["pump_idx"]),
        ("source_min_pct", r["source_min_pct"]),
        ("dest_max_pct", r["dest_max_pct"]),
        ("runtime_level_ok", r["runtime_level_ok"]),
        ("name", r[CONF_NAME]),
    )


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    cg.add(var.set_claims(await cg.get_variable(config[CONF_CLAIMS_ID])))
    cg.add(var.set_safety_override(await cg.get_variable(config[CONF_SAFETY_OVERRIDE_ID])))
    cg.add(var.set_flow_watchdog(await cg.get_variable(config[CONF_FLOW_WATCHDOG_ID])))
    cg.add(var.set_flow_confirm(await cg.get_variable(config[CONF_FLOW_CONFIRM_ID])))
    cg.add(var.set_flow_threshold(await cg.get_variable(config[CONF_FLOW_THRESHOLD_ID])))

    d = config[CONF_DEFAULTS]
    cg.add(var.set_defaults(d["flow_watchdog_ms"], d["flow_confirm_ms"], d["flow_threshold"], d["valve_travel_ms"]))

    for t in config[CONF_TANKS]:
        cg.add(var.add_tank(await _opt_var(t, CONF_SENSOR)))

    for f in config[CONF_FLOWS]:
        handles = cg.StructInitializer(
            FlowHandlesStruct,
            ("rate", await cg.get_variable(f[CONF_RATE])),
            ("total", await _opt_var(f, CONF_TOTAL)),
        )
        cg.add(var.add_flow(handles))

    for v in config[CONF_VALVES]:
        handles = cg.StructInitializer(
            ValveHandlesStruct,
            ("cover", await cg.get_variable(v[CONF_COVER])),
            ("travel_s", await _opt_var(v, CONF_TRAVEL_ID)),
        )
        cg.add(var.add_valve(handles))

    for p in config[CONF_PUMPS]:
        cg.add(var.add_pump(await cg.get_variable(p)))

    for r in config[CONF_ROUTES]:
        handles = cg.StructInitializer(
            RouteHandlesStruct,
            ("max_runtime", await _opt_var(r, "max_runtime_id")),
            ("target_duration", await _opt_var(r, "target_duration_id")),
            ("target_volume", await _opt_var(r, "target_volume_id")),
            ("source_min", await _opt_var(r, "source_min_id")),
            ("dest_max", await _opt_var(r, "dest_max_id")),
            ("flow_stall", await _opt_var(r, "flow_stall_id")),
        )
        cg.add(var.add_route(_route_struct(r), handles))

    for mp in config[CONF_MANUAL_PUMPS]:
        s = cg.StructInitializer(
            ManualPumpStruct,
            ("node_id", mp["node_id"]),
            ("relay_idx", mp["relay_idx"]),
            ("flow_mask", mp["flow_mask"]),
            ("src_tank", mp["src_tank"]),
            ("src_min", mp["src_min"]),
            ("max_rt_ms", mp["max_rt_ms"]),
        )
        cg.add(var.add_manual_pump(s))
