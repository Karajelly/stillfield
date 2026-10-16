import Foundation

// Execute production Swift directly to validate the browser replay's baseline.
var output: [[String: Any]] = []
for fps in [30, 60, 120] {
    for scenario in 0..<3 {
        var tractor = TractorState(x: -15, z: -7, heading: .pi / 2, speed: 0)
        var camera = TractorFollowCamera()
        let obstacles = scenario == 2 ? [Obstacle(x: -10, z: -7, radius: 1.2)] : []
        var pose = camera.update(tractor: tractor, zoom: 0.65, deltaTime: 0)
        for frame in 0..<(fps * 3) {
            let t = Double(frame) / Double(fps)
            let target: FarmPoint? = t >= 2.4 ? nil : (scenario == 1
                ? FarmPoint(x: -18 + sin(t * 2) * 2, z: -10)
                : FarmPoint(x: 12, z: -7 + sin(t * 0.7) * 0.4))
            tractor = FarmSimulation.advance(tractor, toward: target, deltaTime: 1 / Double(fps),
                                              obstacles: obstacles, rowAssist: true, pace: 0.85)
            pose = camera.update(tractor: tractor, zoom: 0.65, deltaTime: 1 / Double(fps), obstacles: obstacles)
        }
        output.append(["fps": fps, "scenario": scenario,
                       "state": [tractor.x, tractor.z, tractor.heading, tractor.speed],
                       "camera": [pose.position.x, pose.position.y, pose.position.z, pose.focus.x, pose.focus.y, pose.focus.z]])
    }
}
let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
