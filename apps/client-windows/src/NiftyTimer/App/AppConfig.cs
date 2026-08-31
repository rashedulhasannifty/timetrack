using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NiftyTimer.App;

/// <summary>
/// Where this build points and which install it is. Stamped into <c>appsettings.json</c> at
/// package time by <c>scripts/package-app.ps1</c>, read once at startup.
///
/// The packaged app IS the artifact employees run, so the packaging script defaults to the
/// PRODUCTION deployment — shipping a build that silently talks to 127.0.0.1 is the worse
/// failure. The fallbacks here are the opposite case: a developer checkout with no packaged
/// settings, which should talk to localhost and must never be mistaken for the released install
/// (see <see cref="AppInstall.Variant"/>).
///
/// The API base MUST keep its <c>/v1</c> suffix — the reverse proxy routes on it, and a shipped
/// client pins <c>/v1</c> forever.
/// </summary>
public sealed record AppConfig
{
    [JsonPropertyName("appId")]
    public string? AppId { get; init; }

    [JsonPropertyName("apiBaseUrl")]
    public string ApiBaseUrl { get; init; } = "http://127.0.0.1:3001/v1";

    [JsonPropertyName("dashboardUrl")]
    public string DashboardUrl { get; init; } = "http://127.0.0.1:3000";

    /// <summary>
    /// The GitHub repository the update feed reads.
    ///
    /// **Deliberately a SEPARATE repository from the macOS client.** GitHub has one
    /// <c>releases/latest</c> per repo, and the shipped Mac client resolves its update through
    /// that endpoint. A Windows release published alongside it would become <c>latest</c> and every
    /// installed Mac client would go silently blind to updates — a regression that could only be
    /// fixed by shipping a Mac update, through the very path that had just broken.
    /// </summary>
    [JsonPropertyName("updateRepo")]
    public string UpdateRepo { get; init; } = "rashedulhasansojib/niftytimer-windows";

    /// <summary>
    /// The API base as a <see cref="Uri"/>, guaranteed to end in a slash.
    ///
    /// This matters: <c>new Uri(base, "projects")</c> against
    /// <c>https://host/v1</c> resolves to <c>https://host/projects</c> — silently dropping the
    /// version prefix and hitting routes that do not exist.
    /// </summary>
    public Uri ApiBaseUri => new(ApiBaseUrl.EndsWith('/') ? ApiBaseUrl : ApiBaseUrl + "/");

    public Uri DashboardUri => new(DashboardUrl);

    public static AppConfig Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        try
        {
            return JsonSerializer.Deserialize<AppConfig>(File.ReadAllBytes(path)) ?? new AppConfig();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new AppConfig();
        }
    }
}

/// <summary>
/// The version and build identity shown at the bottom of the dropdown, so a support conversation
/// can start from "which build are you on" without asking the employee to dig through Programs
/// and Features.
/// </summary>
public static class BuildStamp
{
    public static string Version =>
        Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            .Split('+')[0]
        ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)
        ?? "0.0.0";

    public static string Describe(string? appId)
    {
        var variant = AppInstall.Variant(appId);
        return variant is null ? $"v{Version}" : $"v{Version} ({variant})";
    }
}
