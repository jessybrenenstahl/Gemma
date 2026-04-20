import Foundation

enum MissionRoute: String, CaseIterable, Identifiable, Codable {
    case sendMac = "send_mac"
    case sendPc = "send_pc"
    case sendBoth = "send_both"
    case executeCritique = "execute_critique"
    case compare = "compare"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sendMac:
            return "Send to Mac"
        case .sendPc:
            return "Send to PC"
        case .sendBoth:
            return "Send to Both"
        case .executeCritique:
            return "Execute + Critique"
        case .compare:
            return "Compare"
        }
    }

    var path: String {
        switch self {
        case .sendMac:
            return "/api/routes/send-mac"
        case .sendPc:
            return "/api/routes/send-pc"
        case .sendBoth:
            return "/api/routes/send-both"
        case .executeCritique:
            return "/api/routes/execute-critique"
        case .compare:
            return "/api/routes/compare"
        }
    }
}

struct AppStatusResponse: Decodable {
    let ok: Bool
    let availableRoutes: [String]
    let latestSession: SessionListItem?
    let sessionCount: Int

    enum CodingKeys: String, CodingKey {
        case ok
        case availableRoutes = "available_routes"
        case latestSession = "latest_session"
        case sessionCount = "session_count"
    }
}

struct SessionListResponse: Decodable {
    let sessions: [SessionListItem]
}

struct SessionResponse: Decodable {
    let session: MissionSession
}

struct RouteResponse: Decodable {
    let ok: Bool
    let message: String?
    let session: MissionSession?
    let macResult: LaneExecutionResult?
    let pcResult: LaneExecutionResult?

    enum CodingKeys: String, CodingKey {
        case ok
        case message
        case session
        case macResult = "mac_result"
        case pcResult = "pc_result"
    }
}

struct SessionListItem: Decodable, Identifiable, Hashable {
    let sessionID: String
    let missionGoal: String?
    let operatorMode: String?
    let status: String?
    let updatedAt: String?

    var id: String { sessionID }

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case missionGoal = "mission_goal"
        case operatorMode = "operator_mode"
        case status
        case updatedAt = "updated_at"
    }
}

struct MissionSession: Decodable, Identifiable {
    let sessionID: String
    let status: String
    let updatedAt: String?
    let missionState: MissionState
    let macState: LaneState?
    let pcState: LaneState?
    let transcript: [TranscriptEvent]
    let compareCards: [CompareCard]

    var id: String { sessionID }

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case status
        case updatedAt = "updated_at"
        case missionState = "mission_state"
        case macState = "mac_state"
        case pcState = "pc_state"
        case transcript
        case compareCards = "compare_cards"
    }
}

struct MissionState: Decodable {
    let missionGoal: String?
    let operatorMode: String?
    let arbitrationState: String?
    let activeRiskCount: Int?
    let currentCompareSummary: String?
    let activeRepo: String?

    enum CodingKeys: String, CodingKey {
        case missionGoal = "mission_goal"
        case operatorMode = "operator_mode"
        case arbitrationState = "arbitration_state"
        case activeRiskCount = "active_risk_count"
        case currentCompareSummary = "current_compare_summary"
        case activeRepo = "active_repo"
    }
}

struct LaneState: Decodable {
    let status: String?
    let authorityBadge: String?
    let latencyHint: String?
    let currentTask: String?
    let lastAction: String?
    let repoContext: RepoContext?
    let lastVerifiedResult: LaneSummary?
    let latestErrorGap: LaneSummary?

    enum CodingKeys: String, CodingKey {
        case status
        case authorityBadge = "authority_badge"
        case latencyHint = "latency_hint"
        case currentTask = "current_task"
        case lastAction = "last_action"
        case repoContext = "repo_context"
        case lastVerifiedResult = "last_verified_result"
        case latestErrorGap = "latest_error_gap"
    }
}

struct RepoContext: Decodable {
    let label: String?
    let path: String?
    let source: String?
}

struct LaneSummary: Decodable {
    let summary: String?
}

struct TranscriptEvent: Decodable, Identifiable {
    let id: String
    let lane: String
    let type: String
    let routingMode: String
    let timestamp: String?
    let verified: Bool
    let content: String?

    enum CodingKeys: String, CodingKey {
        case id
        case lane
        case type
        case routingMode = "routing_mode"
        case timestamp
        case verified
        case content
    }
}

struct CompareCard: Decodable, Identifiable {
    let id: String
    let arbitrationStatus: String?
    let createdAt: String?
    let question: String?
    let macAnswerSummary: String?
    let pcAnswerSummary: String?
    let overlap: String?
    let disagreement: String?
    let recommendedNextStep: String?

    enum CodingKeys: String, CodingKey {
        case id
        case arbitrationStatus = "arbitration_status"
        case createdAt = "created_at"
        case question
        case macAnswerSummary = "mac_answer_summary"
        case pcAnswerSummary = "pc_answer_summary"
        case overlap
        case disagreement
        case recommendedNextStep = "recommended_next_step"
    }
}

struct LaneExecutionResult: Decodable {
    let content: String?
    let eventType: String?

    enum CodingKeys: String, CodingKey {
        case content
        case eventType = "event_type"
    }
}

struct RouteRequestBody: Encodable {
    let prompt: String
    let sharedInstruction: String?
    let sessionID: String?

    enum CodingKeys: String, CodingKey {
        case prompt
        case sharedInstruction = "shared_instruction"
        case sessionID = "session_id"
    }
}

enum MissionControlAPIError: LocalizedError {
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Mission control returned an invalid response."
        case let .server(message):
            return message
        }
    }
}

struct MissionControlAPIClient {
    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    func fetchStatus() async throws -> AppStatusResponse {
        try await request(path: "/api/status")
    }

    func fetchSessions(limit: Int = 12) async throws -> SessionListResponse {
        try await request(path: "/api/sessions?limit=\(limit)")
    }

    func fetchSession(sessionID: String) async throws -> SessionResponse {
        let escaped = sessionID.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? sessionID
        return try await request(path: "/api/session?session_id=\(escaped)")
    }

    func runRoute(_ route: MissionRoute, prompt: String, sharedInstruction: String, sessionID: String?) async throws -> RouteResponse {
        let body = RouteRequestBody(
            prompt: prompt,
            sharedInstruction: sharedInstruction.isEmpty ? nil : sharedInstruction,
            sessionID: sessionID
        )
        return try await request(path: route.path, method: "POST", body: body)
    }

    private func request<Response: Decodable>(path: String) async throws -> Response {
        try await request(path: path, method: "GET", body: Optional<RouteRequestBody>.none)
    }

    private func request<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body?) async throws -> Response {
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MissionControlAPIError.invalidResponse
        }

        let decoder = JSONDecoder()
        if (200 ..< 300).contains(httpResponse.statusCode) {
            return try decoder.decode(Response.self, from: data)
        }

        if let errorPayload = try? decoder.decode(RouteResponse.self, from: data) {
            throw MissionControlAPIError.server(errorPayload.message ?? "Request failed.")
        }

        if let generic = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let message = generic["message"] as? String {
            throw MissionControlAPIError.server(message)
        }

        throw MissionControlAPIError.server("Request failed with status \(httpResponse.statusCode).")
    }
}
