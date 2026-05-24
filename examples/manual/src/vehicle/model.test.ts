import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextWheelTargets, sensorWorldPositions } from "./model";

function assertClose(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should be close to ${expected}`);
}

describe("nextWheelTargets", () => {
  it("accelerates both wheels when both turn keys are pressed", () => {
    assert.deepEqual(
      nextWheelTargets(
        { left: 2, right: 3 },
        { leftKeyPressed: true, rightKeyPressed: true },
        { accel: 10, maxSpeed: 8, dt: 0.5 }
      ),
      { left: 8, right: 8 }
    );
  });

  it("drives the opposite wheel for left and right turns", () => {
    assert.deepEqual(
      nextWheelTargets(
        { left: 4, right: 1 },
        { leftKeyPressed: true, rightKeyPressed: false },
        { accel: 10, maxSpeed: 20, dt: 0.2 }
      ),
      { left: 0, right: 3 }
    );
    assert.deepEqual(
      nextWheelTargets(
        { left: 4, right: 1 },
        { leftKeyPressed: false, rightKeyPressed: true },
        { accel: 10, maxSpeed: 20, dt: 0.2 }
      ),
      { left: 6, right: 0 }
    );
  });

  it("stops both wheels when no turn key is pressed", () => {
    assert.deepEqual(
      nextWheelTargets(
        { left: 4, right: 7 },
        { leftKeyPressed: false, rightKeyPressed: false },
        { accel: 10, maxSpeed: 20, dt: 0.2 }
      ),
      { left: 0, right: 0 }
    );
  });
});

describe("sensorWorldPositions", () => {
  it("transforms local sensor points into the vehicle pose frame", () => {
    const [sensor] = sensorWorldPositions(
      { xM: 1, yM: 2, yawRad: Math.PI / 2 },
      [{ x: 0.1, y: 0.2 }]
    );

    assertClose(sensor.x, 0.8);
    assertClose(sensor.y, 2.1);
  });
});
