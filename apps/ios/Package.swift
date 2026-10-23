// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "VoxCodeCore", platforms: [.macOS(.v13), .iOS(.v17)], products: [.library(name: "VoxCodeCore", targets: ["VoxCodeCore"])], targets: [.target(name: "VoxCodeCore"), .testTarget(name: "VoxCodeCoreTests", dependencies: ["VoxCodeCore"])])
