using NiftyTimer.Activity;
using NiftyTimer.Auth;
using NiftyTimer.Capture;
using NiftyTimer.Policy;
using NiftyTimer.Storage;
using NiftyTimer.Sync;

namespace NiftyTimer.Tests.Support;

/// <summary>
/// Hand-written fakes, no mocking framework — the same posture as the macOS client's
/// <c>Tests/TimeTrackTests/Support</c>. Every hardware or network touch in the client sits behind
/// a one-method interface precisely so this stays possible.
/// </summary>
public sealed class FakePolicyProvider : IPolicyProvider
{
    private readonly Func<EffectivePolicy> _next;

    public FakePolicyProvider(EffectivePolicy policy)
        : this(() => policy)
    {
    }

    public FakePolicyProvider(Func<EffectivePolicy> next) => _next = next;

    public int Calls { get; private set; }

    public static EffectivePolicy Policy(bool ackRequired, PolicySettings? settings = null) => new()
    {
        AckRequired = ackRequired,
        PolicyVersion = "v1",
        PolicyText = "We record screenshots and activity.",
        Settings = settings ?? new PolicySettings(),
    };

    public Task<EffectivePolicy> EffectivePolicyAsync(CancellationToken cancellationToken = default)
    {
        Calls++;
        return Task.FromResult(_next());
    }
}

/// <summary>A policy provider that always fails — the offline / mid-deploy case.</summary>
public sealed class FailingPolicyProvider : IPolicyProvider
{
    public int Calls { get; private set; }

    public Task<EffectivePolicy> EffectivePolicyAsync(CancellationToken cancellationToken = default)
    {
        Calls++;
        throw new AckGateException(AckGateFailure.PolicyUnavailable);
    }
}

public sealed class FakeUploader : IUploader
{
    private readonly Queue<UploadResult> _scripted = new();

    public FakeUploader(params UploadResult[] results)
    {
        foreach (var result in results)
        {
            _scripted.Enqueue(result);
        }
    }

    public List<byte[]> Uploads { get; } = [];

    /// <summary>Returned once the scripted results run out.</summary>
    public UploadResult Default { get; set; } = new UploadResult.Success();

    public Task<UploadResult> UploadAsync(byte[] payload, CancellationToken cancellationToken = default)
    {
        Uploads.Add(payload);
        return Task.FromResult(_scripted.Count > 0 ? _scripted.Dequeue() : Default);
    }
}

/// <summary>An uploader that parks inside the call until released — for testing drain overlap.</summary>
public sealed class BlockingUploader : IUploader
{
    private readonly Task _release;
    private readonly TaskCompletionSource _entered = new();

    public BlockingUploader(Task release) => _release = release;

    /// <summary>Completes once the uploader is actually inside a call.</summary>
    public Task Entered => _entered.Task;

    public async Task<UploadResult> UploadAsync(byte[] payload, CancellationToken cancellationToken = default)
    {
        _entered.TrySetResult();
        await _release.ConfigureAwait(false);
        return new UploadResult.Success();
    }
}

public sealed class BufferSpy : ITimeEntryBuffer
{
    public List<(string Id, BufferKind Kind, byte[] Payload)> Entries { get; } = [];

    public void Enqueue(string id, BufferKind kind, byte[] payload) => Entries.Add((id, kind, payload));
}

/// <summary>
/// Input counts under test control. Advancing is explicit, so a sub-bucket's activity is decided
/// by the test rather than by whether the machine happened to be touched while it ran.
/// </summary>
public sealed class FakeInputCounter : IInputCounting
{
    public long KeyEvents { get; private set; }

    public long PointerEvents { get; private set; }

    public void Type(long events = 1) => KeyEvents += events;

    public void Move(long events = 1) => PointerEvents += events;
}

public sealed class FakeAppSampler : IAppSampling
{
    private readonly AppSnapshot _snapshot;

    public FakeAppSampler(AppSnapshot? snapshot = null) =>
        _snapshot = snapshot ?? new AppSnapshot("Visual Studio Code", "code", "README.md");

    public int Calls { get; private set; }

    public Task<AppSnapshot> SampleAsync(CancellationToken cancellationToken = default)
    {
        Calls++;
        return Task.FromResult(_snapshot);
    }
}

public sealed class ActivityBufferSpy : IActivitySampleBuffer
{
    public List<ActivitySamplePayload> Samples { get; } = [];

    public List<string> Removed { get; } = [];

    public int PruneCalls { get; private set; }

    public void Enqueue(ActivitySamplePayload sample) => Samples.Add(sample);

    public IReadOnlyList<ActivitySamplePayload> Take(int limit) => Samples.Take(limit).ToList();

    public void Remove(IEnumerable<string> ids)
    {
        foreach (var id in ids)
        {
            Removed.Add(id);
            Samples.RemoveAll(s => s.Id == id);
        }
    }

    public void Prune(TimeSpan maxAge, int maxCount) => PruneCalls++;

    public void Clear() => Samples.Clear();

    public int PendingCount() => Samples.Count;
}

public sealed class ImageBufferSpy : IImageBuffer
{
    public List<(string Id, DateTimeOffset CapturedAt, byte[] Jpeg, CaptureGroup Group)> Images { get; } = [];

    public List<string> Removed { get; } = [];

    public void Enqueue(string id, DateTimeOffset capturedAt, byte[] jpeg, CaptureGroup group) =>
        Images.Add((id, capturedAt, jpeg, group));

    public IReadOnlyList<BufferedImage> Take(int limit) =>
        Images.Take(limit).Select(i => new BufferedImage(i.Id, i.CapturedAt, i.Group, i.Id + ".jpg")).ToList();

    public void Remove(string id)
    {
        Removed.Add(id);
        Images.RemoveAll(i => i.Id == id);
    }

    public void Prune(TimeSpan maxAge, int maxCount)
    {
    }

    public void Clear() => Images.Clear();

    public int PendingCount() => Images.Count;
}

public sealed class FakeDisplayGrabber : IDisplayGrabber
{
    private readonly Func<DisplayGrabResult> _next;

    public FakeDisplayGrabber(int displays = 2, int attempted = -1)
        : this(() => new DisplayGrabResult(
            Enumerable.Range(0, displays).Select(i => new DisplayCapture(i, [(byte)i, 0xFF])).ToList(),
            attempted < 0 ? displays : attempted))
    {
    }

    public FakeDisplayGrabber(Func<DisplayGrabResult> next) => _next = next;

    public int Calls { get; private set; }

    public Task<DisplayGrabResult> GrabAllAsync(CancellationToken cancellationToken = default)
    {
        Calls++;
        return Task.FromResult(_next());
    }
}

public sealed class FakeScreenshotUploader : IScreenshotUploading
{
    private readonly Queue<UploadResult> _scripted = new();

    public FakeScreenshotUploader(params UploadResult[] results)
    {
        foreach (var result in results)
        {
            _scripted.Enqueue(result);
        }
    }

    public List<string> Uploaded { get; } = [];

    public UploadResult Default { get; set; } = new UploadResult.Success();

    public Task<UploadResult> UploadAsync(
        string id,
        DateTimeOffset capturedAt,
        CaptureGroup group,
        byte[] jpeg,
        CancellationToken cancellationToken = default)
    {
        Uploaded.Add(id);
        return Task.FromResult(_scripted.Count > 0 ? _scripted.Dequeue() : Default);
    }
}

public sealed class FakeAuthClient : IAuthClient
{
    private readonly TimeSpan _delay;

    public FakeAuthClient(TimeSpan? delay = null) => _delay = delay ?? TimeSpan.Zero;

    public int RefreshCalls;

    public int LoginCalls { get; private set; }

    public AuthFailure? RefreshFailure { get; set; }

    public TokenPair Next { get; set; } = new(Jwt.ForSubject("user-1"), "refresh-1", 900);

    public async Task<TokenPair> LoginAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        LoginCalls++;
        await Task.Delay(_delay, cancellationToken).ConfigureAwait(false);
        return Next;
    }

    public async Task<TokenPair> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref RefreshCalls);
        await Task.Delay(_delay, cancellationToken).ConfigureAwait(false);
        if (RefreshFailure is { } failure)
        {
            throw new AuthException(failure, failure == AuthFailure.RefreshRejected ? 401 : 500);
        }

        return Next;
    }
}

/// <summary>Builds unsigned JWTs whose payload carries the claims the client reads.</summary>
public static class Jwt
{
    public static string ForSubject(string sub, string role = "EMPLOYEE", string teamId = "team-1")
    {
        var header = Base64Url("""{"alg":"HS256","typ":"JWT"}"""u8.ToArray());
        var payload = Base64Url(
            System.Text.Encoding.UTF8.GetBytes(
                $$"""{"sub":"{{sub}}","role":"{{role}}","teamId":"{{teamId}}"}"""));
        return $"{header}.{payload}.signature-not-verified-by-the-client";
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>A throwaway directory that cleans itself up.</summary>
public sealed class TempDirectory : IDisposable
{
    public TempDirectory()
    {
        Path = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            "niftytimer-tests",
            Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
    }
}
