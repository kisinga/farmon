"""MajiFlow runtime automation engine (maji_automations).

Imperative shell around the pure automation kernel (core.{h,cpp}). Holds the RAM
automation table filled from a retained MQTT message; a generated 5s interval calls
tick(), firing triggers through the maji_control engine so the route state machine
still gates safety. The route_set_version (manifest-derived) is config — the device
refuses any set authored against a different route table.

Also the holder for the desired-config version round-trip: the server computes an
opaque version for the retained /config message (runtime tunables + calibration); the
generated config-apply lambda (mqtt.ts) applies each number and calls
set_config_version() here, and the snapshot re-emits config_version() so the server can
reconcile desired vs applied config. The device NEVER hashes — it stores the string.
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID

CODEOWNERS = ["@majiflow"]
DEPENDENCIES = ["maji_control"]

maji_automations_ns = cg.esphome_ns.namespace("maji_automations")
MajiAutomations = maji_automations_ns.class_("MajiAutomations", cg.Component)

MajiControl = cg.esphome_ns.namespace("maji_control").class_("MajiControl")

CONF_CONTROL_ID = "control_id"
CONF_ROUTE_SET_VERSION = "route_set_version"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(MajiAutomations),
        cv.Required(CONF_CONTROL_ID): cv.use_id(MajiControl),
        cv.Required(CONF_ROUTE_SET_VERSION): cv.uint16_t,
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    cg.add(var.set_control(await cg.get_variable(config[CONF_CONTROL_ID])))
    cg.add(var.set_route_set_version(config[CONF_ROUTE_SET_VERSION]))
