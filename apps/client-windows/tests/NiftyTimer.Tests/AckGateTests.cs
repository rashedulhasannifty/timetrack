using NiftyTimer.Policy;
using NiftyTimer.Tests.Support;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// PRD §4.1 / CLAUDE.md §1. The gate is the single structural barrier between capture code and
/// the hardware APIs, so these are the highest-value tests in the client.
/// </summary>
public class AckGateTests
{
    [Fact]
    public async Task RunsTheBodyWhenAcknowledged()
    {
        var gate = new AckGate(new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false)));

        var ran = false;
        var result = await gate.WithCaptureAllowedAsync(_ =>
        {
            ran = true;
            return Task.FromResult(42);
        });

        Assert.True(ran);
        Assert.Equal(42, result);
    }

    [Fact]
    public async Task RefusesAndDoesNotRunTheBodyWhenAcknowledgementIsRequired()
    {
        var gate = new AckGate(new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: true)));

        var ran = false;
        var error = await Assert.ThrowsAsync<AckGateException>(() =>
            gate.WithCaptureAllowedAsync(_ =>
            {
                ran = true;
                return Task.FromResult(0);
            }));

        Assert.Equal(AckGateFailure.NotAcknowledged, error.Failure);
        Assert.False(ran);
    }

    /// <summary>
    /// Fail-safe: if the policy cannot be read at all, the gate stays CLOSED. An offline client
    /// must not fall back to "probably still fine" and start capturing.
    /// </summary>
    [Fact]
    public async Task StaysClosedWhenThePolicyCannotBeFetched()
    {
        var gate = new AckGate(new FailingPolicyProvider());

        var ran = false;
        var error = await Assert.ThrowsAsync<AckGateException>(() =>
            gate.WithCaptureAllowedAsync(_ =>
            {
                ran = true;
                return Task.FromResult(0);
            }));

        Assert.Equal(AckGateFailure.PolicyUnavailable, error.Failure);
        Assert.False(ran);
    }

    /// <summary>
    /// The policy is published BEFORE the body runs, so the very cycle that opened the gate
    /// already uses the latest admin settings rather than the previous ones.
    /// </summary>
    [Fact]
    public async Task PublishesThePolicyBeforeRunningTheBody()
    {
        var order = new List<string>();
        var gate = new AckGate(
            new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false)),
            _ => order.Add("published"));

        await gate.WithCaptureAllowedAsync(_ =>
        {
            order.Add("body");
            return Task.FromResult(0);
        });

        Assert.Equal(["published", "body"], order);
    }

    [Fact]
    public async Task DoesNotPublishThePolicyWhenTheGateIsClosed()
    {
        var published = 0;
        var gate = new AckGate(
            new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: true)),
            _ => published++);

        await Assert.ThrowsAsync<AckGateException>(() =>
            gate.WithCaptureAllowedAsync(_ => Task.FromResult(0)));

        Assert.Equal(0, published);
    }

    /// <summary>
    /// Re-fetched every call, not cached. This is what makes a revoked acknowledgement stop
    /// capture mid-session instead of at the next relaunch.
    /// </summary>
    [Fact]
    public async Task RefetchesThePolicyOnEveryCall()
    {
        var provider = new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false));
        var gate = new AckGate(provider);

        await gate.WithCaptureAllowedAsync(_ => Task.FromResult(0));
        await gate.WithCaptureAllowedAsync(_ => Task.FromResult(0));
        await gate.WithCaptureAllowedAsync(_ => Task.FromResult(0));

        Assert.Equal(3, provider.Calls);
    }

    /// <summary>An acknowledgement revoked mid-session closes the gate on the next tick.</summary>
    [Fact]
    public async Task ClosesMidSessionWhenAcknowledgementIsRevoked()
    {
        var ackRequired = false;
        var gate = new AckGate(new FakePolicyProvider(() => FakePolicyProvider.Policy(ackRequired)));

        await gate.WithCaptureAllowedAsync(_ => Task.FromResult(0));

        ackRequired = true;

        await Assert.ThrowsAsync<AckGateException>(() =>
            gate.WithCaptureAllowedAsync(_ => Task.FromResult(0)));
    }
}
