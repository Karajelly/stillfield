import SwiftUI

@main
struct StillfieldApp: App {
    @State private var game = FarmController()

    var body: some Scene {
        WindowGroup {
            FarmScreen(game: game)
                .preferredColorScheme(.light)
        }
    }
}
