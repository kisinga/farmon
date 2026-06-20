"""MajiFlow remote-claim registry (maji_claims).

Shared actuation-intent state: peer controllers (UDP coordination) and the MQTT
manual-command path write timed claims; pump/valve control reads them. Configured
per controller with its local valve ids and the live claim-lease number entity.
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID
from esphome.components import number

CODEOWNERS = ["@majiflow"]

maji_claims_ns = cg.esphome_ns.namespace("maji_claims")
MajiClaims = maji_claims_ns.class_("MajiClaims", cg.Component)

CONF_VALVES = "valves"
CONF_LEASE_NUMBER_ID = "lease_number_id"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(MajiClaims),
        cv.Required(CONF_LEASE_NUMBER_ID): cv.use_id(number.Number),
        cv.Optional(CONF_VALVES, default=[]): cv.ensure_list(cv.string_strict),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    lease = await cg.get_variable(config[CONF_LEASE_NUMBER_ID])
    cg.add(var.set_lease_number(lease))

    for valve in config[CONF_VALVES]:
        cg.add(var.add_valve(valve))
