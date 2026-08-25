using System.Text.Json;

namespace NiftyTimer.Projects;

/// <summary>
/// Last-known project list, so the picker is populated on a launch with no network instead of
/// showing nothing and making the employee guess. Written after every successful fetch, cleared
/// on sign-out so a second user on the same machine never sees the first user's team.
/// </summary>
public sealed class ProjectCache
{
    private readonly string _path;

    public ProjectCache(string path)
    {
        _path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    }

    public IReadOnlyList<Project> Load()
    {
        try
        {
            return JsonSerializer.Deserialize<List<Project>>(File.ReadAllBytes(_path)) ?? [];
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    public void Save(IReadOnlyList<Project> projects)
    {
        var tmp = _path + ".tmp";
        try
        {
            File.WriteAllBytes(tmp, JsonSerializer.SerializeToUtf8Bytes(projects));
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
}
