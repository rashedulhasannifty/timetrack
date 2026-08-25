using System.Runtime.InteropServices;
using System.Text;

namespace NiftyTimer.Auth;

/// <summary>
/// Persists only the long-lived secret (the refresh token). The short-lived access token lives in
/// memory on <see cref="AuthSession"/> and is re-minted via refresh — it is never written to disk.
/// </summary>
public interface ITokenStore
{
    string? ReadRefreshToken();

    void SaveRefreshToken(string token);

    void Clear();
}

/// <summary>
/// DPAPI-backed store — the Windows counterpart of the macOS client's Keychain item.
///
/// <c>CryptProtectData</c> with <c>CRYPTPROTECT_UI_FORBIDDEN</c> ties the ciphertext to the
/// current Windows user account, so another account on the same machine (and anyone reading the
/// file off a stolen disk without the user's credentials) cannot recover the token. That is the
/// same property the Keychain gives with
/// <c>kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly</c>.
///
/// Called through P/Invoke rather than the <c>System.Security.Cryptography.ProtectedData</c>
/// package, so the client keeps its zero-runtime-dependency posture (CLAUDE.md §2).
///
/// The file name is per-install (<see cref="App.AppInstall.TokenFileName"/>): shared with the
/// released app, a dev sign-in would overwrite the token production is using and sign the
/// employee out.
/// </summary>
public sealed class DpapiTokenStore : ITokenStore
{
    private const int CryptprotectUiForbidden = 0x1;

    private readonly string _path;

    public DpapiTokenStore(string path)
    {
        _path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    }

    public string? ReadRefreshToken()
    {
        byte[] cipher;
        try
        {
            cipher = File.ReadAllBytes(_path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }

        var plain = Unprotect(cipher);
        return plain is null ? null : Encoding.UTF8.GetString(plain);
    }

    public void SaveRefreshToken(string token)
    {
        var cipher = Protect(Encoding.UTF8.GetBytes(token));
        if (cipher is null)
        {
            return;
        }

        var tmp = _path + ".tmp";
        try
        {
            File.WriteAllBytes(tmp, cipher);
            File.Move(tmp, _path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            TryDelete(tmp);
        }
    }

    public void Clear() => TryDelete(_path);

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static byte[]? Protect(byte[] plain) => Transform(plain, encrypt: true);

    private static byte[]? Unprotect(byte[] cipher) => Transform(cipher, encrypt: false);

    private static byte[]? Transform(byte[] input, bool encrypt)
    {
        var inBlob = default(DataBlob);
        var outBlob = default(DataBlob);
        try
        {
            inBlob.cbData = input.Length;
            inBlob.pbData = Marshal.AllocHGlobal(Math.Max(1, input.Length));
            Marshal.Copy(input, 0, inBlob.pbData, input.Length);

            var ok = encrypt
                ? CryptProtectData(
                    ref inBlob, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                    CryptprotectUiForbidden, out outBlob)
                : CryptUnprotectData(
                    ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                    CryptprotectUiForbidden, out outBlob);

            if (!ok)
            {
                return null;
            }

            var result = new byte[outBlob.cbData];
            Marshal.Copy(outBlob.pbData, result, 0, outBlob.cbData);
            return result;
        }
        finally
        {
            if (inBlob.pbData != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(inBlob.pbData);
            }

            if (outBlob.pbData != IntPtr.Zero)
            {
                LocalFree(outBlob.pbData);
            }
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
#pragma warning disable SA1307 // Win32 struct field names must match the native layout.
        public int cbData;
        public IntPtr pbData;
#pragma warning restore SA1307
    }

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(
        ref DataBlob dataIn,
        string? description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr promptStruct,
        int flags,
        out DataBlob dataOut);

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(
        ref DataBlob dataIn,
        IntPtr description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr promptStruct,
        int flags,
        out DataBlob dataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr handle);
}

/// <summary>In-memory store for tests.</summary>
public sealed class InMemoryTokenStore : ITokenStore
{
    private string? _token;

    public InMemoryTokenStore(string? initial = null) => _token = initial;

    public string? ReadRefreshToken() => _token;

    public void SaveRefreshToken(string token) => _token = token;

    public void Clear() => _token = null;
}
