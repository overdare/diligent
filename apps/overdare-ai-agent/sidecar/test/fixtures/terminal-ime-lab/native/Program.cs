// @summary Minimal native Windows IME lab shell; no Studio or browser profile reuse.
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 2 || !Uri.TryCreate(args[0], UriKind.Absolute, out var target)
            || target.Scheme != "http" || target.Host != "127.0.0.1")
        {
            MessageBox.Show("Expected a loopback lab URL and a private WebView2 data directory.");
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new LabWindow(target, args[1]));
    }
}

internal sealed class LabWindow : Form
{
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly Uri target;
    private readonly string profile;

    public LabWindow(Uri target, string profile)
    {
        this.target = target;
        this.profile = profile;
        Text = "OVERDARE Terminal IME Lab";
        ClientSize = new Size(1180, 820);
        MinimumSize = new Size(720, 500);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(browser);
        Shown += async (_, _) => await InitializeBrowser();
    }

    private async Task InitializeBrowser()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await browser.EnsureCoreWebView2Async(environment);
            var core = browser.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)
                    || uri.GetLeftPart(UriPartial.Authority) != target.GetLeftPart(UriPartial.Authority))
                    e.Cancel = true;
            };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            Text = $"OVERDARE Terminal IME Lab — WebView2 {environment.BrowserVersionString}";
            core.Navigate(target.ToString());
            browser.Focus();
        }
        catch (Exception error)
        {
            MessageBox.Show(this, error.Message, "Terminal IME Lab startup failed");
            Close();
        }
    }
}
