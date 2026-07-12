import AVFoundation
import Darwin
import Foundation

let env = ProcessInfo.processInfo.environment
let home = FileManager.default.homeDirectoryForCurrentUser.path
let host = env["PI_STT_BRIDGE_HOST"] ?? "127.0.0.1"
let port = UInt16(env["PI_STT_BRIDGE_PORT"] ?? "18765") ?? 18765
let tokenFile = env["PI_STT_BRIDGE_TOKEN_FILE"] ?? "\(home)/.config/pi-voice-stt-bridge/token"
let token = ((try? String(contentsOfFile: tokenFile, encoding: .utf8)) ?? env["PI_STT_BRIDGE_TOKEN"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
let sampleRate = Double(env["PI_STT_BRIDGE_SAMPLE_RATE"] ?? "16000") ?? 16000
let channels = Int(env["PI_STT_BRIDGE_CHANNELS"] ?? "1") ?? 1
let minBytes = Int(env["PI_STT_BRIDGE_MIN_BYTES"] ?? "4096") ?? 4096
let maxSeconds = TimeInterval(env["PI_STT_BRIDGE_MAX_SECONDS"] ?? "120") ?? 120

final class RecordingState {
  private let lock = NSLock()
  private var recorder: AVAudioRecorder?
  private var fileURL: URL?
  private var tempDirectory: URL?
  private var startedAt: Date?

  var isActive: Bool {
    lock.lock()
    defer { lock.unlock() }
    return recorder != nil
  }

  func start() throws {
    lock.lock()
    if recorder != nil {
      lock.unlock()
      throw BridgeError.conflict("recording already active")
    }
    lock.unlock()

    guard requestMicrophoneAccess() else {
      throw BridgeError.forbidden("microphone access denied for Pi Voice STT Bridge")
    }

    let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("pi-voice-stt-bridge-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
    let fileURL = tempDirectory.appendingPathComponent("recording.wav")
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
    ]

    let recorder = try AVAudioRecorder(url: fileURL, settings: settings)
    recorder.prepareToRecord()
    if !recorder.record(forDuration: maxSeconds) {
      try? FileManager.default.removeItem(at: tempDirectory)
      throw BridgeError.internalError("failed to start AVAudioRecorder")
    }

    lock.lock()
    if self.recorder != nil {
      recorder.stop()
      try? FileManager.default.removeItem(at: tempDirectory)
      lock.unlock()
      throw BridgeError.conflict("recording already active")
    }
    self.recorder = recorder
    self.fileURL = fileURL
    self.tempDirectory = tempDirectory
    self.startedAt = Date()
    lock.unlock()
  }

  func stop() throws -> Data {
    let current = takeRecording()
    guard let recorder = current.recorder, let fileURL = current.fileURL else {
      throw BridgeError.conflict("no active recording")
    }

    recorder.stop()
    Thread.sleep(forTimeInterval: 0.05)

    do {
      let audio = try Data(contentsOf: fileURL)
      cleanup(directory: current.tempDirectory)
      if audio.count < minBytes {
        throw BridgeError.unprocessable("recording too small (\(audio.count) bytes)")
      }
      if let maxAmplitude = maxPcm16LeAmplitude(audio), maxAmplitude <= 3 {
        throw BridgeError.unprocessable("recording is silent; check microphone permission/input device")
      }
      return audio
    } catch let error as BridgeError {
      cleanup(directory: current.tempDirectory)
      throw error
    } catch {
      cleanup(directory: current.tempDirectory)
      throw BridgeError.internalError("could not read recording: \(error.localizedDescription)")
    }
  }

  func cancel() {
    let current = takeRecording()
    current.recorder?.stop()
    cleanup(directory: current.tempDirectory)
  }

  private func takeRecording() -> (recorder: AVAudioRecorder?, fileURL: URL?, tempDirectory: URL?) {
    lock.lock()
    defer { lock.unlock() }
    let current = (recorder, fileURL, tempDirectory)
    recorder = nil
    fileURL = nil
    tempDirectory = nil
    startedAt = nil
    return current
  }

  private func cleanup(directory: URL?) {
    if let directory {
      try? FileManager.default.removeItem(at: directory)
    }
  }
}

enum BridgeError: Error {
  case unauthorized
  case forbidden(String)
  case conflict(String)
  case unprocessable(String)
  case internalError(String)

  var status: Int {
    switch self {
    case .unauthorized: return 401
    case .forbidden: return 403
    case .conflict: return 409
    case .unprocessable: return 422
    case .internalError: return 500
    }
  }

  var message: String {
    switch self {
    case .unauthorized: return "unauthorized"
    case .forbidden(let message), .conflict(let message), .unprocessable(let message), .internalError(let message): return message
    }
  }
}

func requestMicrophoneAccess() -> Bool {
  let status = AVCaptureDevice.authorizationStatus(for: .audio)
  switch status {
  case .authorized:
    return true
  case .notDetermined:
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { allowed in
      granted = allowed
      semaphore.signal()
    }
    semaphore.wait()
    return granted
  default:
    return false
  }
}

func maxPcm16LeAmplitude(_ audio: Data) -> Int? {
  guard audio.count >= 44 else { return nil }
  let bytes = [UInt8](audio)
  guard String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF",
        String(bytes: bytes[8..<12], encoding: .ascii) == "WAVE" else { return nil }

  var offset = 12
  while offset + 8 <= bytes.count {
    let chunkId = String(bytes: bytes[offset..<(offset + 4)], encoding: .ascii) ?? ""
    let chunkSize = Int(UInt32(bytes[offset + 4]) | (UInt32(bytes[offset + 5]) << 8) | (UInt32(bytes[offset + 6]) << 16) | (UInt32(bytes[offset + 7]) << 24))
    let dataStart = offset + 8
    let dataEnd = min(dataStart + chunkSize, bytes.count)
    if chunkId == "data" {
      var maxValue = 0
      var index = dataStart
      while index + 1 < dataEnd {
        let raw = Int16(bitPattern: UInt16(bytes[index]) | (UInt16(bytes[index + 1]) << 8))
        let value = abs(Int(raw))
        if value > maxValue { maxValue = value }
        index += 2
      }
      return maxValue
    }
    offset = dataStart + chunkSize + (chunkSize % 2)
  }
  return nil
}

struct HttpRequest {
  let method: String
  let path: String
  let headers: [String: String]
}

let state = RecordingState()

func jsonData(_ payload: [String: Any]) -> Data {
  (try? JSONSerialization.data(withJSONObject: payload, options: [])) ?? Data("{\"ok\":false}".utf8)
}

func writeAll(_ fd: Int32, _ data: Data) {
  data.withUnsafeBytes { buffer in
    guard let baseAddress = buffer.baseAddress else { return }
    var sent = 0
    while sent < data.count {
      let written = Darwin.write(fd, baseAddress.advanced(by: sent), data.count - sent)
      if written <= 0 { break }
      sent += written
    }
  }
}

func sendResponse(_ fd: Int32, status: Int, contentType: String, body: Data) {
  let reason: String
  switch status {
  case 200: reason = "OK"
  case 204: reason = "No Content"
  case 401: reason = "Unauthorized"
  case 403: reason = "Forbidden"
  case 404: reason = "Not Found"
  case 409: reason = "Conflict"
  case 422: reason = "Unprocessable Entity"
  default: reason = "Internal Server Error"
  }

  var headers = "HTTP/1.1 \(status) \(reason)\r\nConnection: close\r\nContent-Length: \(body.count)\r\n"
  if !contentType.isEmpty { headers += "Content-Type: \(contentType)\r\n" }
  headers += "\r\n"
  writeAll(fd, Data(headers.utf8))
  if !body.isEmpty { writeAll(fd, body) }
}

func sendJson(_ fd: Int32, status: Int, _ payload: [String: Any]) {
  sendResponse(fd, status: status, contentType: "application/json; charset=utf-8", body: jsonData(payload))
}

func parseRequest(_ fd: Int32) -> HttpRequest? {
  var data = Data()
  var buffer = [UInt8](repeating: 0, count: 4096)
  while data.count < 65536 {
    let count = Darwin.read(fd, &buffer, buffer.count)
    if count <= 0 { break }
    data.append(buffer, count: count)
    if data.range(of: Data("\r\n\r\n".utf8)) != nil { break }
  }
  guard let text = String(data: data, encoding: .utf8) else { return nil }
  let lines = text.components(separatedBy: "\r\n")
  guard let requestLine = lines.first else { return nil }
  let parts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
  guard parts.count >= 2 else { return nil }
  var headers: [String: String] = [:]
  for line in lines.dropFirst() {
    if line.isEmpty { break }
    if let colon = line.firstIndex(of: ":") {
      let name = line[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
      headers[name] = value
    }
  }
  return HttpRequest(method: parts[0], path: parts[1].split(separator: "?").first.map(String.init) ?? parts[1], headers: headers)
}

func isAuthorized(_ request: HttpRequest) -> Bool {
  token.isEmpty || request.headers["authorization"] == "Bearer \(token)"
}

func handleClient(_ fd: Int32) {
  defer { close(fd) }
  guard let request = parseRequest(fd) else {
    sendJson(fd, status: 400, ["ok": false, "error": "bad request"])
    return
  }

  do {
    if request.method == "GET" && request.path == "/health" {
      guard isAuthorized(request) else { throw BridgeError.unauthorized }
      sendJson(fd, status: 200, [
        "ok": true,
        "active": state.isActive,
        "recorder": "avfoundation-native",
        "sampleRate": sampleRate,
        "channels": channels,
        "tokenRequired": !token.isEmpty,
      ])
      return
    }

    guard request.method == "POST", ["/start", "/stop", "/cancel"].contains(request.path) else {
      sendJson(fd, status: 404, ["ok": false, "error": "not found"])
      return
    }
    guard isAuthorized(request) else { throw BridgeError.unauthorized }

    switch request.path {
    case "/start":
      try state.start()
      sendJson(fd, status: 200, ["ok": true, "startedAt": Int(Date().timeIntervalSince1970 * 1000)])
    case "/stop":
      let audio = try state.stop()
      sendResponse(fd, status: 200, contentType: "audio/wav", body: audio)
    case "/cancel":
      state.cancel()
      sendResponse(fd, status: 204, contentType: "", body: Data())
    default:
      sendJson(fd, status: 404, ["ok": false, "error": "not found"])
    }
  } catch let error as BridgeError {
    sendJson(fd, status: error.status, ["ok": false, "error": error.message])
  } catch {
    sendJson(fd, status: 500, ["ok": false, "error": error.localizedDescription])
  }
}

func createServerSocket() -> Int32 {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else { fatalError("socket failed") }
  var yes: Int32 = 1
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

  var address = sockaddr_in()
  address.sin_family = sa_family_t(AF_INET)
  address.sin_port = port.bigEndian
  address.sin_addr = in_addr(s_addr: inet_addr(host))

  let bindResult = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
      bind(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
    }
  }
  guard bindResult == 0 else { fatalError("bind failed on \(host):\(port): errno \(errno)") }
  guard listen(fd, 32) == 0 else { fatalError("listen failed: errno \(errno)") }
  return fd
}

let serverFd = createServerSocket()
print("[pi-voice-stt-bridge] native listening on http://\(host):\(port)")
fflush(stdout)

while true {
  let clientFd = accept(serverFd, nil, nil)
  if clientFd < 0 {
    if errno == EINTR { continue }
    continue
  }
  DispatchQueue.global(qos: .userInitiated).async {
    handleClient(clientFd)
  }
}
