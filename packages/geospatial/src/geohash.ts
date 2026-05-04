const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lng: number, lat: number, precision = 7): string {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error("geohashEncode: lng/lat must be finite");
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error("geohashEncode: lng/lat out of range");
  }
  if (precision < 1 || precision > 12) {
    throw new Error("geohashEncode: precision must be in [1, 12]");
  }

  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let bit = 0;
  let chBits = 0;
  let even = true;
  let out = "";

  while (out.length < precision) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        chBits = (chBits << 1) | 1;
        lngLo = mid;
      } else {
        chBits = chBits << 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        chBits = (chBits << 1) | 1;
        latLo = mid;
      } else {
        chBits = chBits << 1;
        latHi = mid;
      }
    }
    even = !even;
    bit++;
    if (bit === 5) {
      out += BASE32[chBits];
      bit = 0;
      chBits = 0;
    }
  }
  return out;
}
