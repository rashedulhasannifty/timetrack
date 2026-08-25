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
/// </summary>
public sealed class ProjectClient : IProjectClient
{
    private readonly AuthorizedJsonClient _json;

    public ProjectClient(AuthorizedJsonClient json) => _json = json;

    public async Task<IReadOnlyList<Project>> ListAsync(CancellationToken cancellationToken = default) =>
        await _json.GetAsync<List<Project>>("projects", cancellationToken).ConfigureAwait(false);
}
