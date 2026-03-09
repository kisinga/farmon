// lorawan_frames: persisted ring buffer for LoRaWAN monitor (uplinks/downlinks).
// Backend writes frames here; lazy trim keeps last 500.

migrate((app) => {
  const empty = ""
  const coll = new Collection({
    type: "base",
    name: "lorawan_frames",
    listRule: empty,
    viewRule: empty,
    createRule: empty,
    updateRule: empty,
    deleteRule: empty,
    fields: [
      { name: "time", type: "text" },
      { name: "direction", type: "text" },
      { name: "dev_eui", type: "text" },
      { name: "f_port", type: "number" },
      { name: "kind", type: "text" },
      { name: "payload_hex", type: "text" },
      { name: "phy_len", type: "number" },
      { name: "rssi", type: "number" },
      { name: "snr", type: "number" },
      { name: "gateway_id", type: "text" },
      { name: "error", type: "text" },
    ],
    indexes: [],
  })
  app.save(coll)
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("lorawan_frames")
    app.delete(coll)
  } catch (_) {}
})
