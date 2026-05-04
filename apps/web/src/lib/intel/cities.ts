// Top US cities + populations, hand-curated for the population-threat
// scoring. Real Stage 1+ would query an actual census tile or WorldPop raster.

export interface City {
  name: string;
  state: string;
  lat: number;
  lon: number;
  pop: number;
}

export const US_CITIES: City[] = [
  { name: "New York", state: "NY", lat: 40.7128, lon: -74.006, pop: 8336000 },
  { name: "Los Angeles", state: "CA", lat: 34.0522, lon: -118.2437, pop: 3979000 },
  { name: "Chicago", state: "IL", lat: 41.8781, lon: -87.6298, pop: 2693000 },
  { name: "Houston", state: "TX", lat: 29.7604, lon: -95.3698, pop: 2320000 },
  { name: "Phoenix", state: "AZ", lat: 33.4484, lon: -112.074, pop: 1680000 },
  { name: "Philadelphia", state: "PA", lat: 39.9526, lon: -75.1652, pop: 1584000 },
  { name: "San Antonio", state: "TX", lat: 29.4241, lon: -98.4936, pop: 1547000 },
  { name: "San Diego", state: "CA", lat: 32.7157, lon: -117.1611, pop: 1424000 },
  { name: "Dallas", state: "TX", lat: 32.7767, lon: -96.797, pop: 1343000 },
  { name: "San Jose", state: "CA", lat: 37.3382, lon: -121.8863, pop: 1027000 },
  { name: "Austin", state: "TX", lat: 30.2672, lon: -97.7431, pop: 978000 },
  { name: "Jacksonville", state: "FL", lat: 30.3322, lon: -81.6557, pop: 911000 },
  { name: "San Francisco", state: "CA", lat: 37.7749, lon: -122.4194, pop: 881000 },
  { name: "Seattle", state: "WA", lat: 47.6062, lon: -122.3321, pop: 753000 },
  { name: "Denver", state: "CO", lat: 39.7392, lon: -104.9903, pop: 727000 },
  { name: "Portland", state: "OR", lat: 45.5051, lon: -122.675, pop: 654000 },
  { name: "Las Vegas", state: "NV", lat: 36.1699, lon: -115.1398, pop: 651000 },
  { name: "Sacramento", state: "CA", lat: 38.5816, lon: -121.4944, pop: 525000 },
  { name: "Fresno", state: "CA", lat: 36.7378, lon: -119.7871, pop: 542000 },
  { name: "Tucson", state: "AZ", lat: 32.2226, lon: -110.9747, pop: 548000 },
  { name: "Albuquerque", state: "NM", lat: 35.0844, lon: -106.6504, pop: 564000 },
  { name: "Oakland", state: "CA", lat: 37.8044, lon: -122.2712, pop: 433000 },
  { name: "Bakersfield", state: "CA", lat: 35.3733, lon: -119.0187, pop: 384000 },
  { name: "Stockton", state: "CA", lat: 37.9577, lon: -121.2908, pop: 311000 },
  { name: "Riverside", state: "CA", lat: 33.9533, lon: -117.3962, pop: 328000 },
  { name: "Reno", state: "NV", lat: 39.5296, lon: -119.8138, pop: 264000 },
  { name: "Spokane", state: "WA", lat: 47.6588, lon: -117.426, pop: 229000 },
  { name: "Boise", state: "ID", lat: 43.615, lon: -116.2023, pop: 230000 },
  { name: "Salt Lake City", state: "UT", lat: 40.7608, lon: -111.891, pop: 200000 },
  { name: "Eugene", state: "OR", lat: 44.0521, lon: -123.0868, pop: 173000 },
  { name: "Bend", state: "OR", lat: 44.0582, lon: -121.3153, pop: 100000 },
  { name: "Salem", state: "OR", lat: 44.9429, lon: -123.0351, pop: 175000 },
  { name: "Sparks", state: "NV", lat: 39.5349, lon: -119.7527, pop: 105000 },
  { name: "Carson City", state: "NV", lat: 39.1638, lon: -119.7674, pop: 58000 },
  { name: "Truckee", state: "CA", lat: 39.328, lon: -120.1833, pop: 16000 },
  { name: "South Lake Tahoe", state: "CA", lat: 38.9399, lon: -119.9772, pop: 22000 },
  { name: "Placerville", state: "CA", lat: 38.7296, lon: -120.7986, pop: 11000 },
  { name: "Pollock Pines", state: "CA", lat: 38.7619, lon: -120.5852, pop: 6800 },
  { name: "Sonora", state: "CA", lat: 37.9829, lon: -120.3822, pop: 4900 },
  { name: "Visalia", state: "CA", lat: 36.3302, lon: -119.2921, pop: 134000 },
  { name: "Salinas", state: "CA", lat: 36.6777, lon: -121.6555, pop: 156000 },
  { name: "Coalinga", state: "CA", lat: 36.1396, lon: -120.3601, pop: 17000 },
  { name: "King City", state: "CA", lat: 36.2128, lon: -121.1257, pop: 13000 },
  { name: "Springfield", state: "OR", lat: 44.0462, lon: -123.0220, pop: 60000 },
  { name: "Cottage Grove", state: "OR", lat: 43.7976, lon: -123.0595, pop: 10000 },
  { name: "Klamath Falls", state: "OR", lat: 42.2249, lon: -121.7817, pop: 22000 },
  { name: "Roseburg", state: "OR", lat: 43.2165, lon: -123.3417, pop: 23000 },
  { name: "Grass Valley", state: "CA", lat: 39.2191, lon: -121.0611, pop: 12700 },
  { name: "Auburn", state: "CA", lat: 38.8966, lon: -121.0769, pop: 14000 },
];
