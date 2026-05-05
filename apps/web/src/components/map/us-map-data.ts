// Bake the US states TopoJSON into a server-loadable module so the map
// renders at SSR without an extra fetch. We use the *albers* variant — it's
// pre-projected into pixel space at 975×610, which lets us skip d3-geo at
// runtime entirely. Just feature.geometry → SVG path d=.

import statesAlbersData from "us-atlas/states-albers-10m.json";
import { feature, mesh } from "topojson-client";
import type { FeatureCollection, Geometry, MultiLineString } from "geojson";
import type { Topology, Objects } from "topojson-specification";

type StatesObjects = Objects<{ name: string }> & {
  states: Objects["states"];
};

const topology = statesAlbersData as unknown as Topology<StatesObjects>;

export const STATES_ALBERS_VIEWBOX = "0 0 975 610";

export const STATES_ALBERS = feature(
  topology,
  topology.objects.states,
) as unknown as FeatureCollection<Geometry, { name: string }>;

export const STATE_BORDERS_MESH = mesh(
  topology,
  topology.objects.states,
  (a, b) => a !== b,
) as unknown as MultiLineString;

export const NATION_OUTLINE_MESH = mesh(
  topology,
  topology.objects.states,
  (a, b) => a === b,
) as unknown as MultiLineString;

export type StateFeature = (typeof STATES_ALBERS)["features"][number];
