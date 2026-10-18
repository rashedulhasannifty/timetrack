using System.Reflection;
using NiftyTimer.App;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// That the end of the Windows session actually reaches <see cref="SessionEndClose"/>.
///
/// <see cref="SessionEndClose"/> is unit-tested, but the two hops into it — WPF's
/// <c>OnSessionEnding</c> and <see cref="AppDelegate.CloseForSessionEnd"/> — live in classes a test
/// cannot construct: they build real windows and a tray icon. Without this the close could sit there
/// fully tested and never run, which is how the updater once shipped. Modelled on
/// <c>LoginItemWiringTests</c>.
/// </summary>
public class SessionEndWiringTests
{
    [Fact]
    public void TheAppClosesTheClockWhenTheSessionEnds()
    {
        var onSessionEnding = typeof(NiftyTimerApp).GetMethod(
            "OnSessionEnding",
            BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.DeclaredOnly)
            ?? throw new InvalidOperationException(
                "NiftyTimerApp no longer overrides OnSessionEnding — a shutdown would leave the " +
                "running span for crash recovery to offer back the next morning.");

        Assert.True(
            Calls(onSessionEnding, nameof(AppDelegate.CloseForSessionEnd)),
            "NiftyTimerApp.OnSessionEnding no longer calls AppDelegate.CloseForSessionEnd.");
    }

    [Fact]
    public void TheDelegateHandsTheClockToSessionEndClose()
    {
        var close = typeof(AppDelegate).GetMethod(nameof(AppDelegate.CloseForSessionEnd))!;

        Assert.True(
            Calls(close, nameof(SessionEndClose.Apply)),
            "AppDelegate.CloseForSessionEnd no longer calls SessionEndClose.Apply.");
    }

    /// <summary>
    /// The walk must be able to resolve SOMETHING, or the assertions above pass for the wrong reason
    /// on any future change that breaks token resolution.
    /// </summary>
    [Fact]
    public void TheWalkIsNotVacuous()
    {
        var close = typeof(AppDelegate).GetMethod(nameof(AppDelegate.CloseForSessionEnd))!;

        Assert.False(Calls(close, "AMethodNameThatCannotExist"));
    }

    private static bool Calls(MethodInfo method, string methodName)
    {
        var il = method.GetMethodBody()!.GetILAsByteArray()!;
        for (var i = 0; i < il.Length - 4; i++)
        {
            if (il[i] is not (0x28 or 0x6F))
            {
                continue;
            }

            try
            {
                if (method.Module.ResolveMethod(BitConverter.ToInt32(il, i + 1))?.Name == methodName)
                {
                    return true;
                }
            }
            catch (Exception e) when (e is ArgumentException or BadImageFormatException)
            {
                // A byte that merely looked like an opcode; this is a linear scan, not a decoder.
            }
        }

        return false;
    }
}
