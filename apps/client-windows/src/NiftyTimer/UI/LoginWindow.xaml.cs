using System.Windows;
using NiftyTimer.Auth;

namespace NiftyTimer.UI;

/// <summary>
/// Email + password sign-in. The only credential surface in the client.
///
/// The server address is shown but not editable: it is compiled into the build at package time
/// (see <see cref="App.AppConfig"/>), so an employee cannot be talked into pointing their client
/// somewhere else.
/// </summary>
public partial class LoginWindow : Window
{
    private readonly AuthSession _session;

    public LoginWindow(AuthSession session, Uri apiBaseUrl)
    {
        InitializeComponent();
        _session = session;
        ServerLabel.Text = $"Server: {apiBaseUrl}";
    }

    /// <summary>Raised after a successful sign-in.</summary>
    public event Action? SignedIn;

    private async void OnSignIn(object sender, RoutedEventArgs e)
    {
        var email = EmailBox.Text.Trim();
        var password = PasswordBox.Password;

        if (email.Length == 0 || password.Length == 0)
        {
            ShowError("Enter your email and password.");
            return;
        }

        SetBusy(true);
        try
        {
            await _session.LoginAsync(email, password).ConfigureAwait(true);
            PasswordBox.Clear();
            ShowError(null);
            Hide();
            SignedIn?.Invoke();
        }
        catch (AuthException ex)
        {
            ShowError(ex.Failure switch
            {
                AuthFailure.InvalidCredentials => "That email and password don't match.",
                AuthFailure.Transport => "Can't reach the server. Check your connection and try again.",
                _ => "Sign-in failed. Try again in a moment.",
            });
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void SetBusy(bool busy)
    {
        SignInButton.IsEnabled = !busy;
        SignInButton.Content = busy ? "Signing in…" : "Sign in";
    }

    private void ShowError(string? message)
    {
        ErrorLabel.Text = message ?? string.Empty;
        ErrorLabel.Visibility = message is null ? Visibility.Collapsed : Visibility.Visible;
    }
}
