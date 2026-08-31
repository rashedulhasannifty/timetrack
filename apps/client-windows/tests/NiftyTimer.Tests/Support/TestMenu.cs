using NiftyTimer.App;
using NiftyTimer.Projects;
using NiftyTimer.Storage;
using NiftyTimer.Tracking;

namespace NiftyTimer.Tests;

/// <summary>A MenuViewModel wired to real collaborators over a throwaway directory.</summary>
internal static class TestMenu
{
    public static MenuViewModel Build()
    {
        var root = Path.Combine(Path.GetTempPath(), "niftytimer-tests", Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(root);
        var buffer = new BufferStore(root);
        var settings = new JsonUserSettings(Path.Combine(root, "settings.json"));
        return new MenuViewModel(new TimeTracker(buffer), new SelectionStore(settings));
    }
}
