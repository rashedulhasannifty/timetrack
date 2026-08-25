using System.Text;
using System.Text.Json;
using NiftyTimer.Policy;
using NiftyTimer.Sync;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The wire format the API actually enforces. Every assertion here corresponds to a way the
/// shipped Mac client got it wrong first.
/// </summary>
public class TimeEntryPayloadTests
{
    private static string Serialize(TimeEntryPayload payload) =>
        Encoding.UTF8.GetString(payload.ToJsonUtf8());

    /// <summary>
    /// <c>projectId</c>, <c>taskId</c> and <c>endTime</c> are <c>.nullable()</c> on the server:
    /// present, possibly null. Omitting the key makes the strict-mode Zod pipe answer 422.
    /// </summary>
    [Fact]
    public void NullableFieldsAreWrittenAsExplicitNulls()
    {
        var json = Serialize(new TimeEntryPayload
        {
            Id = "0192f000-0000-7000-8000-000000000000",
            ProjectId = null,
            TaskId = null,
            StartTime = "2026-08-25T09:00:00Z",
            EndTime = null,
            Source = "MANUAL",
            Note = null,
        });

        Assert.Contains("\"projectId\":null", json, StringComparison.Ordinal);
        Assert.Contains("\"taskId\":null", json, StringComparison.Ordinal);
        Assert.Contains("\"endTime\":null", json, StringComparison.Ordinal);
    }

    /// <summary>
    /// <c>note</c> is <c>.optional()</c>, not <c>.nullable()</c> — a null must be OMITTED. The
    /// opposite of the rule above, in the same object, which is exactly why this has a test.
    /// </summary>
    [Fact]
    public void AnAbsentNoteIsOmittedRatherThanNulled()
    {
        var json = Serialize(new TimeEntryPayload
        {
            Id = "0192f000-0000-7000-8000-000000000000",
            ProjectId = "p1",
            TaskId = null,
            StartTime = "2026-08-25T09:00:00Z",
            EndTime = "2026-08-25T09:30:00Z",
            Source = "MANUAL",
            Note = null,
        });

        Assert.DoesNotContain("\"note\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void APresentNoteIsSent()
    {
        var json = Serialize(new TimeEntryPayload
        {
            Id = "0192f000-0000-7000-8000-000000000000",
            ProjectId = "p1",
            TaskId = "t1",
            StartTime = "2026-08-25T09:00:00Z",
            EndTime = "2026-08-25T09:30:00Z",
            Source = "AUTO",
            Note = "pairing on the sync engine",
        });

        Assert.Contains("\"note\":\"pairing on the sync engine\"", json, StringComparison.Ordinal);
    }

    /// <summary>
    /// Request bodies are parsed in Zod STRICT mode: an unexpected field is a 422, not a
    /// silently-ignored extra. So the payload must carry exactly the schema's keys — no helpful
    /// <c>platform</c>, <c>deviceId</c> or <c>clientVersion</c>.
    /// </summary>
    [Fact]
    public void SendsExactlyTheFieldsTheSchemaDefines()
    {
        var json = Serialize(new TimeEntryPayload
        {
            Id = "0192f000-0000-7000-8000-000000000000",
            ProjectId = "p1",
            TaskId = "t1",
            StartTime = "2026-08-25T09:00:00Z",
            EndTime = "2026-08-25T09:30:00Z",
            Source = "MANUAL",
            Note = "n",
        });

        var keys = JsonDocument.Parse(json).RootElement
            .EnumerateObject()
            .Select(p => p.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            ["endTime", "id", "note", "projectId", "source", "startTime", "taskId"],
            keys);
    }
}

public class UploadClassificationTests
{
    /// <summary>
    /// Any 2xx is success. Narrowing this to 200/201 is what wedged the Mac client's activity
    /// buffer when an endpoint answered 202 — every accepted batch was re-sent forever.
    /// </summary>
    [Theory]
    [InlineData(200)]
    [InlineData(201)]
    [InlineData(202)]
    [InlineData(204)]
    [InlineData(299)]
    public void EveryTwoHundredIsSuccess(int status) =>
        Assert.IsType<UploadResult.Success>(TimeEntryUploader.Classify(status));

    [Fact]
    public void UnauthorizedIsAuthFailure() =>
        Assert.IsType<UploadResult.AuthFailed>(TimeEntryUploader.Classify(401));

    [Theory]
    [InlineData(408)]
    [InlineData(429)]
    [InlineData(500)]
    [InlineData(503)]
    [InlineData(599)]
    [InlineData(0)]
    public void TimeoutsThrottlingAndServerErrorsAreTransient(int status) =>
        Assert.IsType<UploadResult.Transient>(TimeEntryUploader.Classify(status));

    [Theory]
    [InlineData(400)]
    [InlineData(403)]
    [InlineData(404)]
    [InlineData(422)]
    public void OtherClientErrorsArePermanent(int status)
    {
        var result = Assert.IsType<UploadResult.Permanent>(TimeEntryUploader.Classify(status));
        Assert.Equal(status, result.Status);
    }

    /// <summary>
    /// 409 is permanent AND carries its status, because one caller needs to tell it apart: the
    /// live publisher turns it into "you're already tracking on another machine" rather than a
    /// generic retry.
    /// </summary>
    [Fact]
    public void ConflictIsPermanentAndKeepsItsStatus()
    {
        var result = Assert.IsType<UploadResult.Permanent>(TimeEntryUploader.Classify(409));
        Assert.Equal(409, result.Status);
    }
}

public class PolicySettingsDecodeTests
{
    /// <summary>
    /// Asserts EVERY field against a full server body. The Mac client shipped a release where
    /// <c>distractionAlertsEnabled</c> was silently unread because the deserializer ignores keys
    /// the client forgot to declare — the failure mode is invisible without a test like this.
    /// </summary>
    [Fact]
    public void DecodesEveryFieldOfAFullServerBody()
    {
        const string body = """
            {
              "ackRequired": false,
              "policyVersion": "2026-08-01",
              "policyText": "We record screenshots.",
              "settings": {
                "idleThresholdMinutes": 7,
                "autoStartOnLogin": true,
                "screenshotsEnabled": true,
                "screenshotIntervalMinutes": 12,
                "captureWindowTitles": false,
                "distractionAlertsEnabled": true,
                "distractionThresholdMinutes": 15,
                "distractionRepeatMinutes": 3,
                "productiveApps": ["code", "devenv"],
                "unproductiveApps": ["steam"],
                "productiveSites": ["github.com"],
                "unproductiveSites": ["reddit.com"]
              }
            }
            """;

        var policy = JsonSerializer.Deserialize<EffectivePolicy>(body)!;

        Assert.False(policy.AckRequired);
        Assert.Equal("2026-08-01", policy.PolicyVersion);
        Assert.Equal("We record screenshots.", policy.PolicyText);

        var s = policy.Settings;
        Assert.Equal(7, s.IdleThresholdMinutes);
        Assert.True(s.AutoStartOnLogin);
        Assert.True(s.ScreenshotsEnabled);
        Assert.Equal(12, s.ScreenshotIntervalMinutes);
        Assert.False(s.CaptureWindowTitles);
        Assert.True(s.DistractionAlertsEnabled);
        Assert.Equal(15, s.DistractionThresholdMinutes);
        Assert.Equal(3, s.DistractionRepeatMinutes);
        Assert.Equal(["code", "devenv"], s.ProductiveApps);
        Assert.Equal(["steam"], s.UnproductiveApps);
        Assert.Equal(["github.com"], s.ProductiveSites);
        Assert.Equal(["reddit.com"], s.UnproductiveSites);
    }

    /// <summary>
    /// Distraction alerts are OPT-IN server-side. A policy body that never mentions the switch
    /// must not nudge — an absent key means OFF, not "use a friendly default".
    /// </summary>
    [Fact]
    public void AbsentOptionalFieldsFallBackToTheServersOwnDefaults()
    {
        const string body = """
            {
              "ackRequired": true,
              "policyVersion": "v0",
              "settings": {
                "idleThresholdMinutes": 5,
                "autoStartOnLogin": false,
                "screenshotsEnabled": false,
                "screenshotIntervalMinutes": 10
              }
            }
            """;

        var settings = JsonSerializer.Deserialize<EffectivePolicy>(body)!.Settings;

        Assert.False(settings.DistractionAlertsEnabled);
        Assert.True(settings.CaptureWindowTitles);
        Assert.Equal(10, settings.DistractionThresholdMinutes);
        Assert.Equal(5, settings.DistractionRepeatMinutes);
        Assert.Empty(settings.ProductiveApps);
    }

    /// <summary>Unknown keys must not break decoding — the server may add fields at any time.</summary>
    [Fact]
    public void IgnoresUnknownKeys()
    {
        const string body = """
            {
              "ackRequired": false,
              "policyVersion": "v1",
              "somethingNew": {"nested": true},
              "settings": {
                "idleThresholdMinutes": 5,
                "autoStartOnLogin": false,
                "screenshotsEnabled": false,
                "screenshotIntervalMinutes": 10,
                "aFieldFromTheFuture": 3
              }
            }
            """;

        var policy = JsonSerializer.Deserialize<EffectivePolicy>(body)!;

        Assert.Equal("v1", policy.PolicyVersion);
        Assert.Equal(5, policy.Settings.IdleThresholdMinutes);
    }
}
