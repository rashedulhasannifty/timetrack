using System.Reflection;
using NiftyTimer.Policy;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// A structural guard, not a behavioural test.
///
/// CLAUDE.md §1 requires that <see cref="AckGate"/> is the single gate between capture code and
/// the hardware APIs, and that it stays a structural gate rather than decaying into scattered
/// runtime <c>if</c>s. The way that decays in practice is a new capture type that simply never
/// takes a gate.
///
/// So: every type living in a capture namespace must accept an <see cref="AckGate"/> in its
/// constructor. S1 ships no capture code at all, so this currently guards an empty set — that is
/// deliberate. It starts failing the moment someone adds an ungated sampler or grabber in S3,
/// which is exactly when the guard is needed and exactly when nobody would think to write it.
/// </summary>
public class CaptureGateGuardTests
{
    private static readonly string[] CaptureNamespaces =
    [
        "NiftyTimer.Capture",
        "NiftyTimer.Activity",
    ];

    [Fact]
    public void EveryCaptureTypeTakesTheAckGate()
    {
        var offenders = new List<string>();

        foreach (var type in typeof(AckGate).Assembly.GetTypes())
        {
            if (type.Namespace is null ||
                !CaptureNamespaces.Contains(type.Namespace) ||
                type.IsInterface ||
                type.IsEnum ||
                type.IsAbstract)
            {
                continue;
            }

            var takesGate = type
                .GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                .Any(c => c.GetParameters().Any(p => p.ParameterType == typeof(AckGate)));

            // Plain data carriers (a sample record, a settings struct) touch no hardware and are
            // exempt; anything with behaviour is not.
            var hasBehaviour = type
                .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Any(m => !m.IsSpecialGetterOrSetter());

            if (hasBehaviour && !takesGate)
            {
                offenders.Add(type.FullName!);
            }
        }

        Assert.True(
            offenders.Count == 0,
            "Capture types must be constructed with an AckGate so no capture path can bypass it. " +
            $"Offenders: {string.Join(", ", offenders)}");
    }
}

internal static class MethodInfoExtensions
{
    /// <summary>
    /// Property accessors and compiler-generated record members are not "behaviour" for the
    /// purposes of the guard above.
    /// </summary>
    public static bool IsSpecialGetterOrSetter(this MethodInfo method) =>
        method.IsSpecialName ||
        method.Name is "Equals" or "GetHashCode" or "ToString" or "<Clone>$" or "Deconstruct" or "PrintMembers";
}
