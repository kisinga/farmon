"""MajiFlow cross-controller coordination transport/codec (maji_coord).

Encodes/decodes HMAC-authenticated claim/reading/held frames over stock ESPHome
`udp:`. Configured per controller with its id, the per-site UDP key, the actuators
it owns (gates incoming claims), and the mirror sensors it publishes imported
readings / claim-confirmations to. The claim registry is the separate maji_claims
component; the two meet only in the generated on_receive lambda.
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID
from esphome.components import sensor, binary_sensor

CODEOWNERS = ["@majiflow"]
AUTO_LOAD = ["json"]

maji_coord_ns = cg.esphome_ns.namespace("maji_coord")
MajiCoord = maji_coord_ns.class_("MajiCoord", cg.Component)

CONF_SELF_ID = "self_id"
CONF_UDP_KEY = "udp_key"
CONF_CONFIRM_TIMEOUT_MS = "confirm_timeout_ms"
CONF_OWNED_ACTUATORS = "owned_actuators"
CONF_IMPORTED_READINGS = "imported_readings"
CONF_IMPORTED_ACTUATORS = "imported_actuators"
CONF_NODE = "node"
CONF_SENSOR = "sensor"

_READING_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NODE): cv.string_strict,
        cv.Required(CONF_SENSOR): cv.use_id(sensor.Sensor),
    }
)

_ACTUATOR_SCHEMA = cv.Schema(
    {
        cv.Required(CONF_NODE): cv.string_strict,
        cv.Required(CONF_SENSOR): cv.use_id(binary_sensor.BinarySensor),
    }
)

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(MajiCoord),
        cv.Required(CONF_SELF_ID): cv.string_strict,
        cv.Required(CONF_UDP_KEY): cv.string,
        cv.Optional(CONF_CONFIRM_TIMEOUT_MS, default=40000): cv.uint32_t,
        cv.Optional(CONF_OWNED_ACTUATORS, default=[]): cv.ensure_list(cv.string_strict),
        cv.Optional(CONF_IMPORTED_READINGS, default=[]): cv.ensure_list(_READING_SCHEMA),
        cv.Optional(CONF_IMPORTED_ACTUATORS, default=[]): cv.ensure_list(_ACTUATOR_SCHEMA),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    cg.add(var.set_self_id(config[CONF_SELF_ID]))
    cg.add(var.set_udp_key(config[CONF_UDP_KEY]))
    cg.add(var.set_confirm_timeout(config[CONF_CONFIRM_TIMEOUT_MS]))

    for node in config[CONF_OWNED_ACTUATORS]:
        cg.add(var.add_owned(node))

    for reading in config[CONF_IMPORTED_READINGS]:
        sens = await cg.get_variable(reading[CONF_SENSOR])
        cg.add(var.add_imported_reading(reading[CONF_NODE], sens))

    for actuator in config[CONF_IMPORTED_ACTUATORS]:
        bsens = await cg.get_variable(actuator[CONF_SENSOR])
        cg.add(var.add_imported_actuator(actuator[CONF_NODE], bsens))
