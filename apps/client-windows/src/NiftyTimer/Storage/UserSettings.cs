using System.Text.Json;

namespace NiftyTimer.Storage;

/// <summary>
/// Small key/value store for non-secret local state — the ack marker, the last signed-in user
/// id, the sticky project selection. The Windows equivalent of macOS <c>UserDefaults</c>, which
/// is automatically scoped to the bundle id; here the scoping comes from living inside the
/// per-install <see cref="App.AppInstall.SupportDirectory"/>.
///
/// Never holds a secret. The refresh token goes through <see cref="Auth.DpapiTokenStore"/>.
/// </summary>
public interface IUserSettings
{
    string? GetString(string key);

    void SetString(string key, string value);

    void Remove(string key);
}

/// <summary>
/// JSON-file-backed <see cref="IUserSettings"/>. Written with the same
/// write-temp-then-rename dance as <see cref="BufferStore"/> so a crash mid-write cannot leave a
/// truncated settings file that loses the ack marker (which would silently re-prompt the user).
/// </summary>
public sealed class JsonUserSettings : IUserSettings
{
    private readonly string _path;
    private readonly Lock _gate = new();
    private Dictionary<string, string> _values;

    public JsonUserSettings(string path)
    {
        _path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        _values = Load(path);
    }

    public string? GetString(string key)
    {
        lock (_gate)
        {
            return _values.GetValueOrDefault(key);
        }
    }

    public void SetString(string key, string value)
    {
        lock (_gate)
        {
            _values[key] = value;
            Save();
        }
    }

    public void Remove(string key)
    {
        lock (_gate)
        {
            if (_values.Remove(key))
            {
                Save();
            }
        }
    }

    private static Dictionary<string, string> Load(string path)
    {
        try
        {
            var json = File.ReadAllBytes(path);
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? [];
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private void Save()
    {
        var tmp = _path + ".tmp";
        try
        {
            File.WriteAllBytes(tmp, JsonSerializer.SerializeToUtf8Bytes(_values));
            File.Move(tmp, _path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            try
            {
                File.Delete(tmp);
            }
            catch (IOException)
            {
            }
        }
    }
}

/// <summary>In-memory settings for tests.</summary>
public sealed class InMemoryUserSettings : IUserSettings
{
    private readonly Dictionary<string, string> _values = [];

    public string? GetString(string key) => _values.GetValueOrDefault(key);

    public void SetString(string key, string value) => _values[key] = value;

    public void Remove(string key) => _values.Remove(key);
}
