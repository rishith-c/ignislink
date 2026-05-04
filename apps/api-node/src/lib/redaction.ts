import {
  IncidentPublicEventSchema,
  toPublicEvent,
  type IncidentInternalEvent,
  type IncidentPublicEvent,
} from "@ignislink/contracts/incident-events";

export function redactIncidentForPublicStream(
  event: IncidentInternalEvent,
  hotspotGeohash6: string,
): IncidentPublicEvent | null {
  return toPublicEvent(event, hotspotGeohash6);
}

export function parsePublicAlert(payload: unknown): IncidentPublicEvent {
  return IncidentPublicEventSchema.parse(payload);
}
