using System.Reflection;
using NiftyTimer.App;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// A structural guard, not a behavioural test.
///
/// The acknowledgement gate is only real if it cannot be routed around, and the way it gets routed
/// around is not malice — it is a tidy-up. Someone notices that <c>ProceedToPolicyAsync</c> and
/// <c>ProceedOffline</c> both "make the app usable", merges them into one method with a boolean,
/// and the offline branch quietly gains the ability to install observation for a user whose
/// acknowledgement the server has never confirmed. The stored ack marker is enough to re-enable
/// MANUAL tracking offline, so the merged version would look correct and pass every behavioural
/// test in the suite.
///
/// So this reads the IL of the offline branch and asserts it cannot reach an installer, one level
/// of helper indirection deep. It is the S1 promise (<c>OfflineCaptureUnreachableTests</c>) finally
/// having something to assert: S1 shipped no capture at all, S2 is the first slice where the
/// offline branch has something it must fail to install.
///
/// Companion to <see cref="CaptureGateGuardTests"/>, which guards the other half — that capture
/// types take the gate. Note the coordinators deliberately do NOT take an <c>AckGate</c>: they are
/// installed <i>through</i> it here, matching the macOS client, which is exactly why this second
/// guard is needed.
/// </summary>
public class OfflineCaptureUnreachableTests
{
    /// <summary>Methods that begin observing the person. None may be reachable from offline.</summary>
    private static readonly string[] Installers =
    [
        "InstallIdleDetection",
        // S3 adds InstallScreenshotCapture / InstallActivitySampling here.
    ];

    private static MethodInfo Method(string name) =>
        typeof(AppDelegate).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException(
            $"AppDelegate.{name} is gone. If it was renamed, rename it here too — do not delete the guard.");

    [Fact]
    public void TheOfflineBranchCannotInstallObservation()
    {
        var forbidden = Installers.Select(Method).ToHashSet();
        var reachable = CalleesOf(Method("ProceedOffline"), depth: 4);

        var offenders = reachable.Intersect(forbidden).Select(m => m.Name).ToList();

        Assert.True(
            offenders.Count == 0,
            "AppDelegate.ProceedOffline must not be able to reach a capture installer — an offline " +
            "launch has no confirmed acknowledgement, so it may re-enable manual tracking and " +
            $"nothing else (CLAUDE.md §1). Reachable: {string.Join(", ", offenders)}");
    }

    /// <summary>
    /// The mirror assertion. Without it this file would still pass if the installer were deleted
    /// outright, or if the gated branch stopped calling it — a green guard over an app that no
    /// longer detects idle at all.
    /// </summary>
    [Fact]
    public void TheGatedBranchDoesInstallObservation()
    {
        var reachable = CalleesOf(Method("ProceedToPolicyAsync"), depth: 4);

        Assert.Contains(Method("InstallIdleDetection"), reachable);
    }

    /// <summary>
    /// Every method this assembly's code calls from <paramref name="root"/>, followed
    /// <paramref name="depth"/> levels down so a helper wrapper cannot launder the call.
    ///
    /// Async methods compile into a state-machine type whose MoveNext holds the real body, so the
    /// walk hops into it — otherwise an <c>async</c> offline branch would scan as empty and this
    /// guard would pass vacuously.
    /// </summary>
    private static HashSet<MethodInfo> CalleesOf(MethodInfo root, int depth)
    {
        var seen = new HashSet<MethodInfo>();

        // The ROOT is unwrapped too, not just its callees. Miss this and an async root scans as
        // empty — its own IL is only the state-machine kickoff, every call it appears to make lives
        // in corelib, and the guard passes without having looked at anything.
        var frontier = Unwrap(root).ToList();

        for (var level = 0; level < depth && frontier.Count > 0; level++)
        {
            var next = new List<MethodBase>();

            foreach (var target in frontier.SelectMany(DirectCallees).SelectMany(Unwrap))
            {
                if (target is MethodInfo info && !seen.Add(info))
                {
                    continue;
                }

                next.Add(target);
            }

            frontier = next;
        }

        return seen;
    }

    /// <summary>An async method's body lives in its state machine's MoveNext; follow it there.</summary>
    private static IEnumerable<MethodBase> Unwrap(MethodBase method)
    {
        yield return method;

        var stateMachine = method.GetCustomAttribute<System.Runtime.CompilerServices.AsyncStateMachineAttribute>();
        var moveNext = stateMachine?.StateMachineType.GetMethod(
            "MoveNext",
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

        if (moveNext is not null)
        {
            yield return moveNext;
        }
    }

    /// <summary>
    /// Resolve every <c>call</c>/<c>callvirt</c>/<c>newobj</c>/<c>ldftn</c> token in a method body.
    ///
    /// <c>ldftn</c> matters as much as <c>call</c>: a lambda passed as a callback is loaded, not
    /// called, so scanning only for calls would miss <c>() =&gt; InstallIdleDetection(...)</c>
    /// entirely — which is precisely the shape the real code uses to hand a closure to the gate.
    /// </summary>
    private static IEnumerable<MethodBase> DirectCallees(MethodBase method)
    {
        var il = method.GetMethodBody()?.GetILAsByteArray();
        if (il is null)
        {
            yield break;
        }

        var module = method.Module;
        var typeArgs = method.DeclaringType?.IsGenericType == true
            ? method.DeclaringType.GetGenericArguments()
            : null;

        for (var i = 0; i < il.Length - 4; i++)
        {
            // call = 0x28, callvirt = 0x6F, newobj = 0x73; ldftn = 0xFE 0x06.
            var isCall = il[i] is 0x28 or 0x6F or 0x73;
            var isLdftn = il[i] == 0xFE && il[i + 1] == 0x06;
            if (!isCall && !isLdftn)
            {
                continue;
            }

            var operandAt = isLdftn ? i + 2 : i + 1;
            if (operandAt + 4 > il.Length)
            {
                continue;
            }

            MethodBase? resolved;
            try
            {
                resolved = module.ResolveMethod(BitConverter.ToInt32(il, operandAt), typeArgs, null);
            }
            catch (Exception e) when (e is ArgumentException or BadImageFormatException)
            {
                // A byte sequence that merely looked like an opcode — this is a linear scan, not a
                // decoder, so false positives are expected and simply skipped.
                continue;
            }

            if (resolved is not null && resolved.Module == typeof(AppDelegate).Module)
            {
                yield return resolved;
            }
        }
    }
}
