import SwiftUI

@main
struct MissionControlMacOSApp: App {
    @StateObject private var model = MissionControlAppModel()

    var body: some Scene {
        WindowGroup("AGRO Mission Control") {
            MissionControlShellView(model: model)
                .background(WindowAccessor { window in
                    configure(window: window)
                })
        }
        .commands {
            MissionControlCommands(model: model)
        }
    }

    private func configure(window: NSWindow) {
        window.minSize = NSSize(width: 1180, height: 760)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.toolbarStyle = .unified
        window.isMovableByWindowBackground = true
        window.identifier = NSUserInterfaceItemIdentifier("agro-mission-control-window")
        window.setFrameAutosaveName("AGROMissionControlWindow")
    }
}
