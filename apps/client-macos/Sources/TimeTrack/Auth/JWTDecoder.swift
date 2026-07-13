import Foundation

/// Decodes the payload segment of a JWT (base64url) into the claims the client needs.
/// No signature verification — the API verifies; the client only needs its own user id
/// (`sub`) for the ack-monitoring call. Mirrors JwtClaimsSchema { sub, role, teamId }.
enum JWTDecoderError: Error { case malformed }

enum JWTDecoder {
    struct Claims: Decodable {
        let sub: String
        let role: String
        let teamId: String
    }

    static func claims(from accessToken: String) throws -> Claims {
        let segments = accessToken.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3 else { throw JWTDecoderError.malformed }
        guard let payload = base64urlDecode(String(segments[1])) else { throw JWTDecoderError.malformed }
        do {
            return try JSONDecoder().decode(Claims.self, from: payload)
        } catch {
            throw JWTDecoderError.malformed
        }
    }

    private static func base64urlDecode(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b.append("=") }
        return Data(base64Encoded: b)
    }
}
