import SwiftUI

struct MissionControlShellView: View {
    @ObservedObject var model: MissionControlAppModel

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .searchable(text: $model.sessionSearch, placement: .sidebar, prompt: "Search sessions")
        .task {
            model.startPolling()
            await model.refreshAll()
        }
        .onDisappear {
            model.stopPolling()
        }
        .toolbar {
            ToolbarItemGroup {
                Button {
                    Task { await model.refreshAll() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }

                Button {
                    Task { await model.openSessionFromDisk() }
                } label: {
                    Label("Open Session File", systemImage: "folder")
                }
            }
        }
    }

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                BrandCard()
                StatusCard(model: model)
                ComposerCard(model: model)
                SessionsCard(model: model)
            }
            .padding(20)
        }
        .background(.clear)
        .navigationTitle("Mission Control")
    }

    @ViewBuilder
    private var detail: some View {
        if let session = model.currentSession {
            SessionDashboardView(session: session, model: model)
                .padding(20)
        } else {
            ContentUnavailableView(
                "No Session Loaded",
                systemImage: "sparkles.rectangle.stack",
                description: Text("Refresh mission control or open a saved session snapshot from disk.")
            )
        }
    }
}

private struct BrandCard: View {
    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Gemma / AGRO")
                    .font(.caption)
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                    .tracking(1.8)
                Text("Mission Control")
                    .font(.largeTitle.weight(.semibold))
                Text("Mac is the primary execution lane. PC is the peer reviewer. This native shell mirrors the existing mission-control contract over HTTP instead of replacing it.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct StatusCard: View {
    @ObservedObject var model: MissionControlAppModel

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Control Plane", systemImage: "switch.2")
                    .font(.headline)
                LabeledContent("Server") {
                    StatusBadge(text: model.serverReachable ? "Online" : "Offline", tone: model.serverReachable ? .green : .red)
                }
                LabeledContent("Base URL") {
                    TextField("http://127.0.0.1:3040", text: $model.baseURLString)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 240)
                }
                LabeledContent("Sessions") {
                    Text("\(model.status?.sessionCount ?? model.sessions.count)")
                }
                LabeledContent("Routes") {
                    Text(model.availableRoutes.map(\.title).joined(separator: ", "))
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(.secondary)
                }
                if !model.flashMessage.isEmpty {
                    Text(model.flashMessage)
                        .font(.footnote)
                        .foregroundStyle(model.flashIsError ? .red : .secondary)
                }
            }
        }
    }
}

private struct ComposerCard: View {
    @ObservedObject var model: MissionControlAppModel

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Route Prompt", systemImage: "paperplane")
                    .font(.headline)

                Picker("Route", selection: $model.selectedRoute) {
                    ForEach(model.availableRoutes) { route in
                        Text(route.title).tag(route)
                    }
                }
                .pickerStyle(.segmented)

                TextField("Shared instruction", text: $model.sharedInstruction, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2 ... 4)

                TextField("Prompt", text: $model.prompt, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(4 ... 8)

                HStack {
                    Button {
                        Task { await model.runSelectedRoute() }
                    } label: {
                        Label(model.isWorking ? "Running..." : model.selectedRoute.title, systemImage: "sparkles")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isWorking)

                    Spacer()

                    Text(model.lastRouteResultSummary)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }
}

private struct SessionsCard: View {
    @ObservedObject var model: MissionControlAppModel

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Sessions", systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                    .font(.headline)

                if model.filteredSessions.isEmpty {
                    Text("No saved sessions available.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.filteredSessions) { item in
                        Button {
                            Task { await model.loadSession(item.sessionID) }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(item.missionGoal ?? "Untitled mission")
                                        .font(.body.weight(.medium))
                                        .lineLimit(2)
                                    Spacer()
                                    Text(item.status ?? "-")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text("\(item.operatorMode ?? "-") · \(relativeDate(item.updatedAt))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(model.selectedSessionID == item.sessionID ? AnyShapeStyle(.quinary) : AnyShapeStyle(.clear))
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct SessionDashboardView: View {
    let session: MissionSession
    @ObservedObject var model: MissionControlAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HeaderStrip(session: session)
                HStack(alignment: .top, spacing: 18) {
                    LaneStateCard(title: "Mac Lane", tint: .teal, lane: session.macState)
                    LaneStateCard(title: "PC Lane", tint: .orange, lane: session.pcState)
                }
                TranscriptSection(title: "Shared", events: session.transcript.filter { $0.lane == "shared" })
                TranscriptSection(title: "Mac", events: session.transcript.filter { $0.lane == "mac" })
                TranscriptSection(title: "PC", events: session.transcript.filter { $0.lane == "pc" })
                CompareSection(cards: session.compareCards)
            }
        }
        .navigationTitle(session.missionState.missionGoal ?? "Mission")
    }
}

private struct HeaderStrip: View {
    let session: MissionSession

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(session.missionState.missionGoal ?? "Untitled mission")
                            .font(.title2.weight(.semibold))
                        Text(session.missionState.currentCompareSummary ?? "No compare summary yet.")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    StatusBadge(text: session.status, tone: statusTone(for: session.status))
                }

                HStack(spacing: 12) {
                    MetaPill(title: "Mode", value: session.missionState.operatorMode ?? "-")
                    MetaPill(title: "Arbitration", value: session.missionState.arbitrationState ?? "-")
                    MetaPill(title: "Risk", value: "\(session.missionState.activeRiskCount ?? 0)")
                    MetaPill(title: "Updated", value: relativeDate(session.updatedAt))
                }
            }
        }
    }
}

private struct LaneStateCard: View {
    let title: String
    let tint: Color
    let lane: LaneState?

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(title)
                        .font(.headline)
                    Spacer()
                    StatusBadge(text: lane?.status ?? "idle", tone: tint)
                }
                LabeledContent("Authority") { Text(lane?.authorityBadge ?? "-") }
                LabeledContent("Latency") { Text(lane?.latencyHint ?? "-") }
                LabeledContent("Task") { Text(lane?.currentTask ?? "No task yet.") }
                LabeledContent("Action") { Text(lane?.lastAction ?? "No action yet.") }
                LabeledContent("Verified") { Text(lane?.lastVerifiedResult?.summary ?? "No verified result yet.") }
                LabeledContent("Gap") { Text(lane?.latestErrorGap?.summary ?? "No active gaps.") }
                LabeledContent("Repo") { Text(lane?.repoContext?.label ?? lane?.repoContext?.path ?? "-") }
            }
        }
    }
}

private struct TranscriptSection: View {
    let title: String
    let events: [TranscriptEvent]

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(title)
                        .font(.headline)
                    Spacer()
                    Text("\(events.count) events")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if events.isEmpty {
                    Text("No events.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(events) { event in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("\(event.type) · \(event.routingMode)")
                                    .font(.subheadline.weight(.medium))
                                Spacer()
                                if event.verified {
                                    Text("verified")
                                        .font(.caption)
                                        .foregroundStyle(.teal)
                                }
                                Text(relativeDate(event.timestamp))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Text(event.content ?? "No content.")
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                        .padding(.vertical, 4)
                        if event.id != events.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
    }
}

private struct CompareSection: View {
    let cards: [CompareCard]

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Compare Cards")
                        .font(.headline)
                    Spacer()
                    Text("\(cards.count)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if cards.isEmpty {
                    Text("No compare cards yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(cards) { card in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(card.question ?? "Compare")
                                    .font(.subheadline.weight(.medium))
                                Spacer()
                                Text(card.arbitrationStatus ?? "-")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Text("Mac: \(card.macAnswerSummary ?? "-")")
                            Text("PC: \(card.pcAnswerSummary ?? "-")")
                            Text("Overlap: \(card.overlap ?? "-")")
                            Text("Disagreement: \(card.disagreement ?? "-")")
                            Text("Next: \(card.recommendedNextStep ?? "-")")
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                        if card.id != cards.last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
    }
}

struct MissionControlCommands: Commands {
    @ObservedObject var model: MissionControlAppModel

    var body: some Commands {
        CommandMenu("Mission Control") {
            Button("Refresh") {
                Task { await model.refreshAll() }
            }
            .keyboardShortcut("r")

            Button("Open Session File") {
                Task { await model.openSessionFromDisk() }
            }
            .keyboardShortcut("o")
        }
    }
}

private struct PanelCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.white.opacity(0.14))
        )
    }
}

private struct StatusBadge: View {
    let text: String
    let tone: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(tone.opacity(0.16), in: Capsule())
            .foregroundStyle(tone)
    }
}

private struct MetaPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.medium))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: Capsule())
    }
}

private func relativeDate(_ isoDate: String?) -> String {
    guard let isoDate else { return "-" }
    let formatter = ISO8601DateFormatter()
    guard let date = formatter.date(from: isoDate) else { return isoDate }
    return date.formatted(date: .abbreviated, time: .shortened)
}

private func statusTone(for status: String) -> Color {
    switch status.lowercased() {
    case "ok", "online", "complete":
        return .green
    case "pending", "running", "active":
        return .teal
    case "warn", "warning":
        return .orange
    case "error", "offline", "failed":
        return .red
    default:
        return .secondary
    }
}
