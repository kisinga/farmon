"""MajiFlow on-device operator dashboard (maji_local_ui).

Serves the local UI on the shared web_server_base (replacing the stock ESPHome
web_server v3 page when the topology's local.ui flag is on): the gzipped
single-page app at GET /, an SSE ControllerSnapshot stream at GET /local/state,
and the command / automation-set POST endpoints under /local/.

The component is a thin HTTP shell: the command dispatch and automation-blob
validation glue (which needs id() access) is generated into local-ui.yaml and
installed via set_command_handler / set_automations_handler on boot. See
maji_local_ui.h for the endpoint + threading model.
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import web_server_base
from esphome.components.web_server_base import CONF_WEB_SERVER_BASE_ID
from esphome.const import CONF_ID, CONF_PORT

CODEOWNERS = ["@majiflow"]
DEPENDENCIES = ["web_server_base", "maji_control"]
# The generated glue parses command envelopes with esphome::json (mqtt always
# loads it too, but the local UI must not depend on that).
AUTO_LOAD = ["json"]

maji_local_ui_ns = cg.esphome_ns.namespace("maji_local_ui")
MajiLocalUi = maji_local_ui_ns.class_("MajiLocalUi", cg.Component)

MajiControl = cg.esphome_ns.namespace("maji_control").class_("MajiControl")
MajiAutomations = cg.esphome_ns.namespace("maji_automations").class_("MajiAutomations")

CONF_CONTROL_ID = "control_id"
CONF_AUTOS_ID = "autos_id"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(MajiLocalUi),
        # Same default-resolution trick as captive_portal: the lone web_server_base
        # block generates a deterministic id, so this resolves without the user
        # naming it.
        cv.GenerateID(CONF_WEB_SERVER_BASE_ID): cv.use_id(web_server_base.WebServerBase),
        cv.Required(CONF_CONTROL_ID): cv.use_id(MajiControl),
        cv.Required(CONF_AUTOS_ID): cv.use_id(MajiAutomations),
        # web_server_base has no port option (the consumer owns it) — the port 80
        # pin that web_server had moves here.
        cv.Optional(CONF_PORT, default=80): cv.port,
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    base = await cg.get_variable(config[CONF_WEB_SERVER_BASE_ID])
    var = cg.new_Pvariable(config[CONF_ID], base)
    await cg.register_component(var, config)

    cg.add(var.set_control(await cg.get_variable(config[CONF_CONTROL_ID])))
    cg.add(var.set_automations(await cg.get_variable(config[CONF_AUTOS_ID])))
    cg.add(var.set_port(config[CONF_PORT]))
