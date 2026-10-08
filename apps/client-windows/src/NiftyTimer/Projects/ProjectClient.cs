using NiftyTimer.Auth;

namespace NiftyTimer.Projects;

public interface IProjectClient
{
    Task<IReadOnlyList<Project>> ListAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Fetches the team's projects (with tasks) for the picker. <c>GET /v1/projects</c> is available
/// to any authenticated user and is team-scoped server-side — it deliberately carries no
/// <c>@Roles</c> precisely so the desktop client can call it. <c>includeArchived</c> is omitted,
/// so the API returns assignable-only projects.
///
/// Any failure propagates so the caller falls back to <see cref="ProjectCache"/> rather than
/// showing an empty picker.
///
/// An ADMIN asks for every team (<c>allTeams=true</c>).
/// </summary>
public sealed class ProjectClient : IProjectClient
{
    private readonly AuthorizedJsonClient _json;
    private readonly Func<PickerViewer?> _viewer;

    /// <param name="viewer">Who is asking; an ADMIN gets every team's projects. Null → today's request.</param>
    public ProjectClient(AuthorizedJsonClient json, Func<PickerViewer?>? viewer = null)
    {
        _json = json;
        _viewer = viewer ?? (() => null);
    }

    /// <summary>
    /// Relative to the <c>/</c>-terminated <c>…/v1/</c> base (see <c>AppConfig</c>), so the query
    /// string survives <c>new Uri(base, path)</c>.
    /// </summary>
    public static string ListPath(PickerViewer? viewer) =>
        viewer is { IsAdmin: true } ? "projects?allTeams=true" : "projects";

    public async Task<IReadOnlyList<Project>> ListAsync(CancellationToken cancellationToken = default) =>
        await _json.GetAsync<List<Project>>(ListPath(_viewer()), cancellationToken).ConfigureAwait(false);
}
