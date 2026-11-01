// Predict a wing-wide corridor and keep a chosen escape side until it is clear.
// steer uses Flight's convention: positive banks and turns toward negative x at heading 0.
export class ObstacleAvoidance {
  constructor(terrain, obstacleTop) {
    this.terrain = terrain;
    this.obstacleTop = obstacleTop;
    this.side = 0;
    this.clearTime = 0;
  }

  sample(pos, heading, speed, dt) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    const reach = Math.max(100, speed * 8);
    let highest = 0, terrainAhead = 0, near = 0, nearHazard = false, water = true, danger = 0, distance = Infinity;
    const costs = [0, 0];
    // 10 m longitudinal spacing catches ordinary building footprints; half-wing
    // offsets include the extremities and center of each wing.
    const steps = Math.ceil(reach / 10);
    for (let i = 0; i <= steps; i++) {
      const d = reach * i / steps;
      for (const lateral of [-14, -7, 0, 7, 14]) {
        const x = pos.x + fx * d + rx * lateral;
        const z = pos.z + fz * d + rz * lateral;
        const terrain = this.terrain(x, z);
        const roof = this.obstacleTop(x, z);
        if (terrain > -1 || roof > -1) water = false;
        const top = Math.max(0, terrain, roof);
        highest = Math.max(highest, top);
        terrainAhead = Math.max(terrainAhead, terrain);
        if (d <= Math.max(22, speed * 0.7)) {
          near = Math.max(near, top);
          if (terrain > -1 || roof > -1) nearHazard = true;
        }
        if (roof > -1 && roof + 14 > pos.y && d > 5) {
          danger = 1;
          distance = Math.min(distance, d);
          // A blocked right side favors positive steer (turn left), and vice versa.
          costs[lateral >= 0 ? 0 : 1] += 1 / (1 + d / 30);
          if (lateral === 0) costs[1] += 1 / (1 + d / 30);
        }
      }
    }
    // Probe wider lanes so a central obstacle does not select a side blocked
    // by an adjacent building outside the immediate wing corridor.
    if (danger && !this.side) {
      for (const lateral of [-42, -28, 28, 42]) {
        for (let d = 30; d <= reach; d += 20) {
          const roof = this.obstacleTop(pos.x + fx * d + rx * lateral, pos.z + fz * d + rz * lateral);
          if (roof > -1 && roof + 14 > pos.y) costs[lateral > 0 ? 0 : 1] += 1 / (1 + d / 30);
        }
      }
    }
    if (danger > 0) {
      this.clearTime = 0;
      if (!this.side) this.side = costs[0] <= costs[1] ? -1 : 1;
    } else if (this.side) {
      this.clearTime += dt;
      if (this.clearTime > 1.5) this.side = 0;
    }
    return { steer: this.side * 0.8, highest, terrainAhead, near, nearHazard, water, distance };
  }
}
