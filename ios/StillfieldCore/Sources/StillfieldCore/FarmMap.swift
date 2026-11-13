import Foundation

/// A rectangle of 50 cm cells. Matches `FieldBounds` in src/simulation.ts.
public struct FieldBounds: Hashable, Sendable {
    public let minX: Double, maxX: Double, minZ: Double, maxZ: Double
    public let cellSize: Double
    public var columns: Int { Int(((maxX - minX) / cellSize).rounded()) }
    public var rows: Int { Int(((maxZ - minZ) / cellSize).rounded()) }
    public var cellCount: Int { columns * rows }
    public var centre: FarmPoint { FarmPoint(x: (minX + maxX) / 2, z: (minZ + maxZ) / 2) }

    public init(minX: Double, maxX: Double, minZ: Double, maxZ: Double, cellSize: Double = 0.5) {
        self.minX = minX; self.maxX = maxX; self.minZ = minZ; self.maxZ = maxZ; self.cellSize = cellSize
    }
    public func contains(_ p: FarmPoint) -> Bool {
        p.x.isFinite && p.z.isFinite && p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ
    }
    /// The original working field beside the barn.
    public static let home = FieldBounds(minX: -25, maxX: 20, minZ: -12, maxZ: 13)
    /// Twice the home field's area (and cells), to the west along the lane past the tree line.
    public static let foxglove = FieldBounds(minX: -117, maxX: -57, minZ: -18, maxZ: 19.5)
    public static let all: [FieldBounds] = [.home, .foxglove]
    /// The field that contains a ground point, if any.
    public static func containing(_ p: FarmPoint) -> FieldBounds? { all.first { $0.contains(p) } }
}

/// Where the tractor may roam: both fields, the lanes, and the meadow around them.
public enum FarmWorld {
    public static let minX = -125.0, maxX = 39.0, minZ = -30.0, maxZ = 28.0
    public static func clamp(_ p: FarmPoint) -> FarmPoint {
        FarmPoint(x: min(maxX, max(minX, p.x)), z: min(maxZ, max(minZ, p.z)))
    }
    public static func contains(_ p: FarmPoint) -> Bool {
        p.x.isFinite && p.z.isFinite && (minX...maxX).contains(p.x) && (minZ...maxZ).contains(p.z)
    }
}

/// Identity, bounds, and harvest display placement for each field. Matches `FieldSite`.
public struct FieldSite: Equatable, Sendable {
    public let id: String
    public let name: String
    public let bounds: FieldBounds
    public let displayLocation: FarmPoint
    /// Only the original field has starter plots and legacy saves.
    public let original: Bool

    public static let home = FieldSite(id: "willowbrook", name: "Home field", bounds: .home,
                                       displayLocation: FarmPoint(x: -16, z: -15.5), original: true)
    public static let foxglove = FieldSite(id: "foxglove", name: "Foxglove field", bounds: .foxglove,
                                           displayLocation: FarmPoint(x: -87, z: -23), original: false)
    public static let all: [FieldSite] = [.home, .foxglove]
    /// A save's field ID names its site. Unknown IDs belong to the original field.
    public static func site(id: String) -> FieldSite { all.first { $0.id == id } ?? .home }
}

/// The lane between the two fields, the view that follows it, and rides along it.
/// Matches src/farm-map.ts.
public enum FarmMap {
    /// The lane's centreline, from the home loop's west side to Foxglove's east side.
    public static let lane: [FarmPoint] = [
        FarmPoint(x: -27, z: -1), FarmPoint(x: -33, z: -0.4), FarmPoint(x: -41, z: -1.4),
        FarmPoint(x: -49, z: -0.6), FarmPoint(x: -55, z: -1),
    ]
    /// Where a ride along the lane begins and ends, a few metres inside each field.
    static func entrance(_ site: FieldSite) -> FarmPoint {
        site.id == FieldSite.foxglove.id ? FarmPoint(x: -62, z: -1) : FarmPoint(x: -19, z: -1)
    }

    /// 0 frames the home field, 1 frames Foxglove field. The view holds still while
    /// the tractor works inside either field, then follows it along the lane, so taps
    /// and drags never slide under a finger mid-row.
    public static func viewBlend(_ p: FarmPoint) -> Double {
        guard p.x.isFinite else { return 0 }
        let home = FieldBounds.home, far = FieldBounds.foxglove
        let t = min(1, max(0, (home.minX - p.x) / (home.minX - far.maxX)))
        return t * t * (3 - 2 * t)
    }
    /// The field the view currently belongs to.
    public static func site(forView blend: Double) -> FieldSite { blend < 0.5 ? .home : .foxglove }
    /// The other end of the lane from wherever the view belongs.
    public static func destination(from p: FarmPoint) -> FieldSite { viewBlend(p) < 0.5 ? .foxglove : .home }

    /// Step around anything sitting on a straight leg, keeping to the side it leans.
    private static func around(_ from: FarmPoint, _ to: FarmPoint, obstacles: [Obstacle]) -> [FarmPoint] {
        let dx = to.x - from.x, dz = to.z - from.z, length = hypot(dx, dz)
        guard length >= 1e-6 else { return [] }
        var detours: [(along: Double, point: FarmPoint)] = []
        for o in obstacles {
            let along = ((o.x - from.x) * dx + (o.z - from.z) * dz) / length
            guard along > 0, along < length else { continue }
            let across = ((o.x - from.x) * dz - (o.z - from.z) * dx) / length
            guard abs(across) < o.radius + 1.6 else { continue }
            // Pass on the side the leg already favours; a dead-centre hit passes left.
            let side: Double = across > 0 ? -1 : 1, offset = o.radius + 2.6
            detours.append((along, FarmPoint(x: o.x + side * dz / length * offset, z: o.z - side * dx / length * offset)))
        }
        return detours.sorted { $0.along < $1.along }.map(\.point)
    }

    /// Waypoints from the tractor to the other field: across its own field to the lane,
    /// along the lane, and a few metres into the destination.
    public static func route(from start: FarmPoint, to destination: FieldSite, obstacles: [Obstacle] = []) -> [FarmPoint] {
        let west = destination.id == FieldSite.foxglove.id
        let ordered = west ? lane : lane.reversed()
        let stops = ordered.filter { west ? $0.x < start.x - 1 : $0.x > start.x + 1 } + [entrance(destination)]
        var route: [FarmPoint] = [], previous = start
        for stop in stops {
            route += around(previous, stop, obstacles: obstacles) + [stop]
            previous = stop
        }
        return route
    }
}

/// A ride down the lane: one waypoint at a time through the shared navigation, with
/// the implement lifted. Any tap, pause, or obstacle simply ends it. Matches `LaneRide`.
public final class LaneRide {
    public enum Progress: Equatable, Sendable { case riding, arrived, blocked }
    public let destination: FieldSite
    public private(set) var route: [FarmPoint]
    public let end: FarmPoint
    private let navigation: TractorNavigation
    private let obstacles: [Obstacle]

    public init(to destination: FieldSite, from state: TractorState, navigation: TractorNavigation, obstacles: [Obstacle] = []) {
        self.destination = destination
        self.navigation = navigation
        self.obstacles = obstacles
        let route = FarmMap.route(from: FarmPoint(x: state.x, z: state.z), to: destination, obstacles: obstacles)
        self.route = route
        end = route.last ?? FarmPoint(x: state.x, z: state.z)
        navigation.cancel()
        advance(state)
    }
    private func advance(_ state: TractorState) {
        guard !route.isEmpty else { return }
        navigation.choose(route.removeFirst(), state: state, tool: .wander, obstacles: obstacles)
    }
    /// Call after each navigation step. Waypoints roll on before the tractor slows.
    public func update(_ state: TractorState, blocked: Bool) -> Progress {
        if blocked { return .blocked }
        let waypoint = navigation.target
        if waypoint == nil && route.isEmpty { return .arrived }
        if let waypoint, !route.isEmpty, hypot(waypoint.x - state.x, waypoint.z - state.z) >= 2.5 { return .riding }
        if waypoint == nil || !route.isEmpty { advance(state) }
        return .riding
    }
}
