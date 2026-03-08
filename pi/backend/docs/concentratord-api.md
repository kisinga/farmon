# ChirpStack Concentratord ZMQ API

This document describes the communication contract between the backend and ChirpStack Concentratord. Source: [ChirpStack concentratord documentation](https://www.chirpstack.io/docs/chirpstack-concentratord/).

Protobuf definitions: `api/proto/gw/gw.proto` in [chirpstack/chirpstack](https://github.com/chirpstack/chirpstack). Go package: `github.com/chirpstack/chirpstack/api/go/v4/gw`.

## Commands (ZMQ REQ)

The backend sends commands to Concentratord over a **REQ** socket. Each request is a multipart message:

- **Frame 0:** Command type (string).
- **Frame 1:** Command payload (Protobuf-encoded, or empty where noted).

| Command       | Frame 0      | Frame 1                     | Response              |
|---------------|--------------|-----------------------------|-----------------------|
| `gateway_id`  | `"gateway_id"` | empty                       | 8-byte gateway ID     |
| `down`        | `"down"`     | `DownlinkFrame` (Protobuf)   | `DownlinkTxAck` (Protobuf) |
| `config`      | `"config"`   | `GatewayConfiguration` (Protobuf) | empty             |

Channel/region configuration is **file-based** (TOML). The backend does **not** push config by default; Concentratord is configured once per HAT/region via the setup script. The `config` command is optional and model-specific (pushing a channel set that does not fit the hardware can cause the daemon to panic).

## Events (ZMQ SUB)

Concentratord publishes events on a **PUB** socket. The backend subscribes with a **SUB** socket. Each message:

- **Frame 0:** Event type (string).
- **Frame 1:** Event payload (Protobuf).

| Event   | Frame 0   | Frame 1 (payload)                                      |
|---------|-----------|--------------------------------------------------------|
| uplink  | `"up"`    | Protobuf (`Event` with `uplink_frame` or raw `UplinkFrame`) |
| stats   | `"stats"` | `GatewayStats` (Protobuf)                              |

Subscribe to `"up"` (and optionally `"stats"`) by setting the SUB socket option before receiving.
