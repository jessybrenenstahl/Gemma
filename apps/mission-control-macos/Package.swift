// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "MissionControlMacOS",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .executable(
            name: "MissionControlMacOS",
            targets: ["MissionControlMacOS"]
        )
    ],
    targets: [
        .executableTarget(
            name: "MissionControlMacOS",
            path: "Sources"
        )
    ]
)
