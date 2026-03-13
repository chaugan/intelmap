// Shared ballistic math functions used by firing-range.js and vulnerability.js

// Mils to radians (NATO: 6400 mils = 2π)
export function milsToRad(mils) {
  return mils * (Math.PI / 3200);
}

// ---- Tube Artillery (parabolic trajectory) ----

// Required elevation angles to hit target at horizontal distance d with altitude diff dh
export function requiredElevations(v0, d, dh, g = 9.81) {
  const v2 = v0 * v0;
  const discriminant = v2 * v2 - g * (g * d * d + 2 * dh * v2);
  if (discriminant < 0) return null; // unreachable
  const sq = Math.sqrt(discriminant);
  return {
    thetaHigh: Math.atan2(v2 + sq, g * d),
    thetaLow: Math.atan2(v2 - sq, g * d),
  };
}

// Shell altitude at intermediate horizontal distance x
export function trajectoryHeight(x, theta, v0, gunAlt, g = 9.81) {
  const cosT = Math.cos(theta);
  return gunAlt + x * Math.tan(theta) - (g * x * x) / (2 * v0 * v0 * cosT * cosT);
}

// Check if a trajectory clears all intermediate terrain
export function clearsTerrain(theta, v0, gunAlt, gunLat, gunLon, bearingRad, totalDist, getElevation, destination, traceStep = 200) {
  const numChecks = Math.floor(totalDist / traceStep);
  for (let i = 1; i <= numChecks; i++) {
    const x = i * traceStep;
    if (x >= totalDist) break;
    const shellAlt = trajectoryHeight(x, theta, v0, gunAlt);
    const pt = destination(gunLat, gunLon, bearingRad, x);
    const terrainElev = getElevation(pt.lon, pt.lat);
    if (terrainElev > shellAlt) return false;
  }
  return true;
}

// ---- Rocket Artillery (thrust + ballistic trajectory) ----

// Rocket altitude at horizontal distance x
export function rocketHeightAtDist(x, theta, launchVel, thrustAccel, burnTime, gunAlt, g = 9.81) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Horizontal distance covered during thrust phase
  const xBurn = launchVel * cosT * burnTime + 0.5 * thrustAccel * cosT * burnTime * burnTime;

  if (x <= xBurn && xBurn > 0) {
    const a = 0.5 * thrustAccel * cosT;
    const b = launchVel * cosT;
    if (a === 0 && b === 0) return gunAlt;
    let t;
    if (a === 0) {
      t = x / b;
    } else {
      const disc = b * b + 4 * a * x;
      if (disc < 0) return gunAlt;
      t = (-b + Math.sqrt(disc)) / (2 * a);
    }
    return gunAlt + launchVel * sinT * t + 0.5 * (thrustAccel * sinT - g) * t * t;
  }

  // Ballistic phase after burnout
  const vxBo = (launchVel + thrustAccel * burnTime) * cosT;
  const vyBo = (launchVel + thrustAccel * burnTime) * sinT - g * burnTime;
  const yBurn = gunAlt + launchVel * sinT * burnTime + 0.5 * (thrustAccel * sinT - g) * burnTime * burnTime;

  if (vxBo <= 0) return gunAlt;
  const dx = x - xBurn;
  const dt = dx / vxBo;

  return yBurn + vyBo * dt - 0.5 * g * dt * dt;
}

// Find required elevation angle(s) for rocket to hit target at distance d with altitude diff dh
export function rocketRequiredElevations(launchVel, thrustAccel, burnTime, d, dh, minElRad, maxElRad, g = 9.81) {
  const steps = 360;
  const step = (maxElRad - minElRad) / steps;
  if (step <= 0) return null;

  const solutions = [];
  let prevVal = null;

  for (let i = 0; i <= steps; i++) {
    const theta = minElRad + i * step;
    const h = rocketHeightAtDist(d, theta, launchVel, thrustAccel, burnTime, 0, g);
    const val = h - dh;

    if (prevVal !== null && !isNaN(val) && !isNaN(prevVal) && prevVal * val < 0) {
      let lo = minElRad + (i - 1) * step;
      let hi = theta;
      let loVal = prevVal;
      for (let j = 0; j < 30; j++) {
        const mid = (lo + hi) / 2;
        const midH = rocketHeightAtDist(d, mid, launchVel, thrustAccel, burnTime, 0, g);
        const midVal = midH - dh;
        if (isNaN(midVal)) break;
        if (midVal * loVal < 0) {
          hi = mid;
        } else {
          lo = mid;
          loVal = midVal;
        }
      }
      solutions.push((lo + hi) / 2);
    }
    if (!isNaN(val)) prevVal = val;
  }

  if (solutions.length === 0) return null;

  if (solutions.length === 1) {
    return { thetaLow: solutions[0], thetaHigh: solutions[0] };
  }
  return {
    thetaLow: Math.min(...solutions),
    thetaHigh: Math.max(...solutions),
  };
}

// Check if a rocket trajectory clears all intermediate terrain
export function rocketClearsTerrain(theta, launchVel, thrustAccel, burnTime, gunAlt, gunLat, gunLon, bearingRad, totalDist, getElevation, destination, traceStep = 200) {
  const numChecks = Math.floor(totalDist / traceStep);
  for (let i = 1; i <= numChecks; i++) {
    const x = i * traceStep;
    if (x >= totalDist) break;
    const rocketAlt = rocketHeightAtDist(x, theta, launchVel, thrustAccel, burnTime, gunAlt);
    const pt = destination(gunLat, gunLon, bearingRad, x);
    const terrainElev = getElevation(pt.lon, pt.lat);
    if (terrainElev > rocketAlt) return false;
  }
  return true;
}
