using System.Text.RegularExpressions;
using System.Windows;

namespace NiftyTimer.App;

/// <summary>
/// A local record of errors nothing else caught, so the next "it disappeared from the tray" report
/// arrives with evidence instead of a guess.
///
/// Before this there was no handler above the dispatcher at all: an unhandled exception ended the
/// process with no message and no trace, and the only sign was an icon that was no longer there.
/// <see cref="Install"/> subscribes to every place .NET reports one. It records and does NOT
/// swallow — a UI-thread exception still ends the process, because carrying on in a state nobody
/// anticipated is how a time tracker records the wrong thing.
///
/// The file stays on the machine; nothing uploads it. It holds the exception type, message and
/// stack only, and <see cref="Redact"/> strips what CLAUDE.md §4 forbids logging even locally: a
/// bearer or JWT token that reached a message, and the Windows account name inside a profile path.
/// It is capped at <see cref="MaxBytes"/> with one rotated copy, so a crash loop cannot fill the
/// disk.
/// </summary>
public sealed partial class CrashLog
{
    /// <summary>Past this size the file is rotated to <c>crash.log.1</c> before the next write.</summary>
    internal const long MaxBytes = 256 * 1024;

    private readonly string _path;
    private readonly Func<DateTimeOffset> _clock;
    private readonly object _gate = new();

    public CrashLog(string directory, Func<DateTimeOffset>? clock = null)
    {
        _path = Path.Combine(directory, "crash.log");
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public string FilePath => _path;

    /// <summary>
    /// Subscribe to every unhandled-error channel. Must run before anything else in startup, or a
    /// failure while the app is being built is exactly as silent as before.
    /// </summary>
    public void Install(Application app)
    {
        app.DispatcherUnhandledException += (_, e) => Write(e.Exception, "UI thread");
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception exception)
            {
                Write(exception, "background thread");
            }
        };
        TaskScheduler.UnobservedTaskException += (_, e) => Write(e.Exception, "unobserved task");
    }

    /// <summary>Record an exception, and where it surfaced.</summary>
    public void Write(Exception exception, string source) =>
        Write($"{source}: {Redact(exception.ToString())}");

    /// <summary>
    /// Record a line. Best-effort: a log that cannot be written must never become a second failure
    /// on top of the one being recorded.
    /// </summary>
    public void Write(string message)
    {
        try
        {
            lock (_gate)
            {
                var directory = Path.GetDirectoryName(_path);
                if (directory is not null)
                {
                    Directory.CreateDirectory(directory);
                }

                if (File.Exists(_path) && new FileInfo(_path).Length > MaxBytes)
                {
                    File.Move(_path, _path + ".1", overwrite: true);
                }

                var stamp = _clock().ToString("O", System.Globalization.CultureInfo.InvariantCulture);
                File.AppendAllText(
                    _path,
                    $"{stamp} v{BuildStamp.Version}{Environment.NewLine}{Redact(message)}{Environment.NewLine}{Environment.NewLine}");
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Nowhere left to report it. Dropping the line is the lesser failure.
        }
    }

    /// <summary>
    /// Strip what must not be written even to a local file: bearer and JWT tokens, and the account
    /// name in the user's profile path.
    /// </summary>
    internal static string Redact(string text)
    {
        var redacted = BearerToken().Replace(text, "Bearer [redacted]");
        redacted = Jwt().Replace(redacted, "[redacted-token]");

        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrEmpty(profile))
        {
            redacted = redacted.Replace(profile, "%USERPROFILE%", StringComparison.OrdinalIgnoreCase);
        }

        return redacted;
    }

    [GeneratedRegex(@"Bearer\s+\S+", RegexOptions.IgnoreCase)]
    private static partial Regex BearerToken();

    [GeneratedRegex(@"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*")]
    private static partial Regex Jwt();
}
