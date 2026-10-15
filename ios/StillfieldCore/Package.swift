// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "StillfieldCore",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [.library(name: "StillfieldCore", targets: ["StillfieldCore"])],
    targets: [
        .target(name: "StillfieldCore"),
        .testTarget(name: "StillfieldCoreTests", dependencies: ["StillfieldCore"])
    ]
)
