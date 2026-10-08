import Foundation

/// An unsigned JWT carrying the claims the client reads (`sub`, `role`, `teamId`).
func testJWT(sub: String = "11111111-1111-7111-8111-111111111111", role: String, teamId: String) -> String {
    func b64url(_ s: String) -> String {
        Data(s.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    return b64url(#"{"alg":"HS256"}"#) + "." + b64url(#"{"sub":"\#(sub)","role":"\#(role)","teamId":"\#(teamId)"}"#) + ".sig"
}
