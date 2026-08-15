import CryptoKit
import Foundation
import Security

enum UpdateInstallError: Error, Equatable {
    /// The bundle's parent directory is not writable — a managed/MDM Mac, or an app installed
    /// by a different admin. Detected before anything is downloaded so the user is sent to the
    /// releases page instead of failing halfway through a swap.
    case destinationNotWritable(String)
    case download(Int)
    /// The zip did not match the published digest. Never proceed.
    case checksumMismatch(expected: String, actual: String)
    case extractionFailed(String)
    /// The downloaded bundle does not satisfy the running app's designated requirement.
    case signatureRejected(OSStatus)
    case noAppInArchive
    case swapFailed(String)
}

/// Downloads, verifies and swaps in a new build.
///
/// Two independent checks gate the swap, and both must pass:
///
///  1. **SHA-256** against the digest published beside the asset — catches a truncated or
///     corrupted download.
///  2. **The running app's designated requirement** — catches a substituted bundle. This is the
///     one that matters: `codesign --verify` alone only proves a signature is internally
///     consistent, and anyone can sign anything. Checking against *our own* DR proves the new
///     bundle carries the same identity as the code doing the checking.
///
/// That second check buys a second guarantee for free: the identity the DR pins is exactly what
/// TCC keys a Screen Recording grant to. A bundle that passes therefore also keeps the user's
/// existing permission. The corollary is that this updater deliberately CANNOT carry users
/// across a signing-identity change — the Developer ID cutover has to be a manual reinstall,
/// which is already true for TCC reasons.
struct UpdateInstaller {
    let session: URLSession
    let fileManager: FileManager

    init(session: URLSession = .shared, fileManager: FileManager = .default) {
        self.session = session
        self.fileManager = fileManager
    }

    /// Cheap precheck, safe to call before offering the update at all.
    func canInstall(bundleURL: URL = Bundle.main.bundleURL) -> Bool {
        fileManager.isWritableFile(atPath: bundleURL.deletingLastPathComponent().path)
    }

    /// Downloads and stages the update, returning the validated bundle. Does not swap.
    func stage(_ manifest: ReleaseManifest, bundleURL: URL = Bundle.main.bundleURL) async throws -> URL {
        guard canInstall(bundleURL: bundleURL) else {
            throw UpdateInstallError.destinationNotWritable(bundleURL.deletingLastPathComponent().path)
        }

        let work = fileManager.temporaryDirectory
            .appendingPathComponent("TimeTrackUpdate-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: work, withIntermediateDirectories: true)

        // 1. download
        let (tmp, response) = try await session.download(from: manifest.zipURL)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw UpdateInstallError.download(status) }
        let zip = work.appendingPathComponent("update.zip")
        try fileManager.moveItem(at: tmp, to: zip)

        // 2. checksum
        let actual = try Self.sha256(of: zip)
        guard actual == manifest.sha256.lowercased() else {
            throw UpdateInstallError.checksumMismatch(expected: manifest.sha256.lowercased(), actual: actual)
        }

        // 3. extract. ditto preserves the bundle's symlinks and extended attributes; unzip does
        //    not, and a mangled Frameworks symlink breaks the signature we are about to check.
        let extracted = work.appendingPathComponent("x", isDirectory: true)
        try fileManager.createDirectory(at: extracted, withIntermediateDirectories: true)
        let ditto = Process()
        ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        ditto.arguments = ["-x", "-k", zip.path, extracted.path]
        let err = Pipe()
        ditto.standardError = err
        try ditto.run()
        ditto.waitUntilExit()
        guard ditto.terminationStatus == 0 else {
            let text = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            throw UpdateInstallError.extractionFailed(text.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        let apps = (try? fileManager.contentsOfDirectory(at: extracted, includingPropertiesForKeys: nil))?
            .filter { $0.pathExtension == "app" } ?? []
        guard let app = apps.first else { throw UpdateInstallError.noAppInArchive }

        // 4. signature, against our own designated requirement
        if let status = Self.rejectionReason(for: app) {
            throw UpdateInstallError.signatureRejected(status)
        }
        return app
    }

    /// Hands the swap to a detached script and asks the app to quit.
    ///
    /// A process cannot reliably replace its own bundle while running, so the script waits for
    /// this PID to exit first. The order is rollback-safe: the current bundle is renamed aside,
    /// and only deleted once the new one is in place and relaunched. Any failure puts the old
    /// bundle back, so a half-finished update never leaves the user with no app.
    func swapAndRelaunch(staged: URL, bundleURL: URL = Bundle.main.bundleURL) throws {
        let script = fileManager.temporaryDirectory
            .appendingPathComponent("tt-swap-\(UUID().uuidString).sh")
        try Self.swapScript.write(to: script, atomically: true, encoding: .utf8)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)

        let backup = bundleURL.deletingLastPathComponent()
            .appendingPathComponent(bundleURL.lastPathComponent + ".old-\(UUID().uuidString)")

        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier),
                       bundleURL.path, staged.path, backup.path]
        do { try p.run() } catch { throw UpdateInstallError.swapFailed("\(error)") }
    }

    static func sha256(of file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// nil when the bundle satisfies the running app's designated requirement.
    static func rejectionReason(for app: URL) -> OSStatus? {
        var me: SecCode?
        guard SecCodeCopySelf([], &me) == errSecSuccess, let me else { return errSecCSObjectRequired }
        var meStatic: SecStaticCode?
        guard SecCodeCopyStaticCode(me, [], &meStatic) == errSecSuccess, let meStatic else {
            return errSecCSObjectRequired
        }
        var requirement: SecRequirement?
        guard SecCodeCopyDesignatedRequirement(meStatic, [], &requirement) == errSecSuccess,
              let requirement else { return errSecCSReqFailed }

        var candidate: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &candidate) == errSecSuccess,
              let candidate else { return errSecCSStaticCodeNotFound }

        let result = SecStaticCodeCheckValidity(candidate, [], requirement)
        return result == errSecSuccess ? nil : result
    }

    private static let swapScript = """
    #!/bin/sh
    # Replace a running .app once it has exited. Argument order:
    #   $1 pid of the app to wait for, $2 current bundle, $3 staged bundle, $4 backup path
    set -u
    PID="$1"; CUR="$2"; NEW="$3"; BACKUP="$4"

    # Bounded wait — never hang forever holding a half-applied update.
    i=0
    while kill -0 "$PID" 2>/dev/null; do
      i=$((i + 1))
      [ "$i" -gt 300 ] && exit 1
      sleep 0.1
    done

    rm -rf "$BACKUP"
    mv "$CUR" "$BACKUP" || exit 1
    if ! mv "$NEW" "$CUR"; then
      mv "$BACKUP" "$CUR"   # roll back; better an old app than no app
      exit 1
    fi

    # Past this point the new bundle is verified AND in place, so a failed relaunch is not a
    # reason to undo it: `open` failing says nothing about the bundle, and tearing a good build
    # out to restore an old one risks ending up with no app at all. Leave it, keep the backup so
    # a human still has a way back, and report failure.
    if open "$CUR"; then
      rm -rf "$BACKUP"
    else
      exit 1
    fi
    """
}
