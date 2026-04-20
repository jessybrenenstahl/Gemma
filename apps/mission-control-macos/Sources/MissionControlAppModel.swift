import AppKit
import Combine
import Foundation

@MainActor
final class MissionControlAppModel: ObservableObject {
    @Published var baseURLString = "http://127.0.0.1:3040"
    @Published var prompt = ""
    @Published var sharedInstruction = ""
    @Published var sessionSearch = ""
    @Published var status: AppStatusResponse?
    @Published var sessions: [SessionListItem] = []
    @Published var currentSession: MissionSession?
    @Published var selectedSessionID: String?
    @Published var selectedRoute: MissionRoute = .sendMac
    @Published var isWorking = false
    @Published var flashMessage = ""
    @Published var flashIsError = false
    @Published var lastRouteResultSummary = "No route run yet."
    @Published var serverReachable = false

    private var pollTask: Task<Void, Never>?

    var filteredSessions: [SessionListItem] {
        let query = sessionSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sessions }
        return sessions.filter { item in
            item.sessionID.localizedCaseInsensitiveContains(query)
                || (item.missionGoal ?? "").localizedCaseInsensitiveContains(query)
                || (item.operatorMode ?? "").localizedCaseInsensitiveContains(query)
        }
    }

    var availableRoutes: [MissionRoute] {
        let routeKeys = status?.availableRoutes ?? MissionRoute.allCases.map(\.rawValue)
        return MissionRoute.allCases.filter { routeKeys.contains($0.rawValue) }
    }

    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.refreshAll(quiet: true)
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refreshAll(quiet: Bool = false) async {
        do {
            let client = try apiClient()
            async let statusResponse = client.fetchStatus()
            async let sessionsResponse = client.fetchSessions()
            let (freshStatus, freshSessions) = try await (statusResponse, sessionsResponse)
            status = freshStatus
            sessions = freshSessions.sessions
            serverReachable = freshStatus.ok

            if selectedSessionID == nil {
                selectedSessionID = freshStatus.latestSession?.sessionID ?? freshSessions.sessions.first?.sessionID
            }

            if let selectedSessionID {
                let sessionResponse = try await client.fetchSession(sessionID: selectedSessionID)
                currentSession = sessionResponse.session
            }

            if !quiet {
                setFlash("Mission control refreshed.")
            }
        } catch {
            serverReachable = false
            if !quiet {
                setFlash(error.localizedDescription, isError: true)
            }
        }
    }

    func loadSession(_ sessionID: String) async {
        do {
            let session = try await apiClient().fetchSession(sessionID: sessionID).session
            currentSession = session
            selectedSessionID = session.sessionID
            setFlash("Loaded session \(session.sessionID).")
        } catch {
            setFlash(error.localizedDescription, isError: true)
        }
    }

    func runSelectedRoute() async {
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPrompt.isEmpty else {
            setFlash("Prompt is required.", isError: true)
            return
        }

        isWorking = true
        defer { isWorking = false }

        do {
            let response = try await apiClient().runRoute(
                selectedRoute,
                prompt: trimmedPrompt,
                sharedInstruction: sharedInstruction,
                sessionID: currentSession?.sessionID
            )

            if let session = response.session {
                currentSession = session
                selectedSessionID = session.sessionID
            }

            prompt = ""
            lastRouteResultSummary = [
                response.macResult?.content,
                response.pcResult?.content,
                response.message
            ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first ?? "\(selectedRoute.title) completed."

            setFlash("\(selectedRoute.title) completed.")
            await refreshAll(quiet: true)
        } catch {
            setFlash(error.localizedDescription, isError: true)
        }
    }

    func openSessionFromDisk() async {
        guard let url = SessionFilePanel.openSessionJSON() else {
            return
        }

        do {
            let data = try Data(contentsOf: url)
            let decoded = try JSONDecoder().decode(MissionSession.self, from: data)
            currentSession = decoded
            selectedSessionID = decoded.sessionID
            setFlash("Loaded session from \(url.lastPathComponent).")
        } catch {
            setFlash("Failed to open session file: \(error.localizedDescription)", isError: true)
        }
    }

    private func apiClient() throws -> MissionControlAPIClient {
        guard let url = URL(string: baseURLString) else {
            throw MissionControlAPIError.server("Invalid mission-control URL.")
        }
        return MissionControlAPIClient(baseURL: url)
    }

    private func setFlash(_ message: String, isError: Bool = false) {
        flashMessage = message
        flashIsError = isError
    }
}
