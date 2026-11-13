import Foundation

/// A ground tap marks completed work. The vehicle continues until its trailing tool reaches it.
final class WorkDestination {
    let point: FarmPoint
    let center: FarmPoint
    let cell: Int
    let corners: [FarmPoint]
    private var heading: Double
    private var routePoint: FarmPoint
    private var locked: Bool
    private var aligning: Bool

    /// The field the destination's cell belongs to.
    let field: FieldBounds

    static func create(_ point: FarmPoint, state: TractorState, tool: FarmTool) -> WorkDestination? {
        guard tool != .wander, let field = FieldBounds.containing(point) else { return nil }
        return WorkDestination(point, state: state, field: field)
    }
    private init(_ point: FarmPoint, state: TractorState, field: FieldBounds) {
        self.point = point
        self.field = field
        let size = field.cellSize
        let col = Int(TractorHandling.clamp(floor((point.x - field.minX) / size), 0, Double(field.columns - 1)))
        let row = Int(TractorHandling.clamp(floor((point.z - field.minZ) / size), 0, Double(field.rows - 1)))
        cell = row * field.columns + col
        let center = FarmPoint(x: field.minX + (Double(col) + 0.5) * size, z: field.minZ + (Double(row) + 0.5) * size)
        self.center = center
        corners = [-0.5, 0.5].flatMap { x in [-0.5, 0.5].map { z in FarmPoint(x: center.x + x * size, z: center.z + z * size) } }
        let dx = center.x - state.x, dz = center.z - state.z
        let along = dx * sin(state.heading) + dz * cos(state.heading)
        let across = dx * cos(state.heading) - dz * sin(state.heading)
        let underSwath = abs(across) < TractorHandling.brushRadius - size && along >= -TractorHandling.attachmentOffset && along < 2
        heading = underSwath ? state.heading : atan2(dx, dz)
        routePoint = underSwath ? FarmPoint(x: state.x + sin(state.heading) * along, z: state.z + cos(state.heading) * along) : center
        locked = underSwath
        aligning = !underSwath && hypot(dx, dz) <= 4.5 && abs(TractorHandling.angle(heading, state.heading)) > 0.3
    }
    func plan(_ state: TractorState) -> (target: FarmPoint, paceScale: Double) {
        let distance = hypot(center.x - state.x, center.z - state.z)
        if aligning {
            heading = atan2(center.x - state.x, center.z - state.z)
            if abs(TractorHandling.angle(heading, state.heading)) < 0.1 && state.speed < 0.15 {
                aligning = false; locked = true
            }
        } else if !locked && distance > 4.5 { heading = atan2(center.x - state.x, center.z - state.z) }
        else { locked = true }
        let brush = TractorHandling.attachment(state)
        let remaining = max(0, hypot(brush.x - center.x, brush.z - center.z) - (TractorHandling.brushRadius - field.cellSize * sqrt(2) / 2))
        return (FarmPoint(x: routePoint.x + sin(heading) * (TractorHandling.attachmentOffset + 0.6),
                          z: routePoint.z + cos(heading) * (TractorHandling.attachmentOffset + 0.6)),
                aligning ? 0 : TractorHandling.clamp((remaining + 0.4) / 3, 0.2, 1))
    }
    func covered(_ state: TractorState) -> Bool {
        let brush = TractorHandling.attachment(state)
        let throughEnd = (brush.x - routePoint.x) * sin(heading) + (brush.z - routePoint.z) * cos(heading)
        return throughEnd >= 0 && corners.allSatisfy { hypot($0.x - brush.x, $0.z - brush.z) <= TractorHandling.brushRadius }
    }
    func setArrivalHeading(_ heading: Double) {
        routePoint = point; self.heading = heading; locked = true; aligning = false
    }
}
