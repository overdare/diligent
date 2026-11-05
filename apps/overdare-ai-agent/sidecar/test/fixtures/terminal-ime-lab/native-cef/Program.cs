// @summary Same-version CEF comparison shell using a private copy of Studio's actual runtime.
using CefSharp;
using CefSharp.WinForms;
using System.Runtime.InteropServices;

internal static class Program
{
    [DllImport("libcef.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int cef_version_info(int entry);

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 2 || !Uri.TryCreate(args[0], UriKind.Absolute, out var target)
            || target.Scheme != "http" || target.Host != "127.0.0.1")
        {
            MessageBox.Show("Expected a loopback lab URL and a private CEF data directory.");
            return;
        }
        ApplicationConfiguration.Initialize();
        var settings = new CefSettings
        {
            RootCachePath = args[1],
            CachePath = Path.Combine(args[1], "Default"),
            ResourcesDirPath = AppContext.BaseDirectory,
            LocalesDirPath = Path.Combine(AppContext.BaseDirectory, "Resources", "locales"),
            LogFile = Path.Combine(args[1], "cef.log"),
        };
        Directory.CreateDirectory(args[1]);
        if (!Cef.Initialize(settings, performDependencyCheck: true, browserProcessHandler: null))
        {
            MessageBox.Show("CEF initialization failed. Check the lab's private cef.log.");
            return;
        }
        try
        {
            // Cef.CefVersion/ChromiumVersion describe the wrapper's build headers,
            // not the DLL loaded at runtime. Query the actual Studio CEF binary.
            var cefVersion = $"{cef_version_info(0)}.{cef_version_info(1)}.{cef_version_info(2)}";
            var chromiumVersion = string.Join(".", Enumerable.Range(4, 4).Select(cef_version_info));
            if (cefVersion != "128.4.13" || chromiumVersion != "128.0.6613.138")
                throw new InvalidOperationException($"Unexpected runtime CEF {cefVersion} / Chromium {chromiumVersion}");
            File.WriteAllText(Path.Combine(args[1], "runtime-version.txt"), $"CEF={cefVersion}\nChromium={chromiumVersion}\n");
            using var form = new Form
            {
                Text = $"OVERDARE Terminal IME Lab — CEF {cefVersion} / Chromium {chromiumVersion}",
                ClientSize = new Size(1180, 820),
                MinimumSize = new Size(720, 500),
                StartPosition = FormStartPosition.CenterScreen,
            };
            using var browser = new ChromiumWebBrowser(target.ToString())
            {
                Dock = DockStyle.Fill,
                RequestHandler = new LoopbackRequestHandler(target),
            };
            form.Controls.Add(browser);
            Application.Run(form);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Same-version CEF lab failed");
        }
        finally
        {
            Cef.Shutdown();
        }
    }
}

internal sealed class LoopbackRequestHandler(Uri target) : CefSharp.Handler.RequestHandler
{
    protected override bool OnBeforeBrowse(IWebBrowser chromiumWebBrowser, IBrowser browser, IFrame frame,
        IRequest request, bool userGesture, bool isRedirect)
    {
        return !Uri.TryCreate(request.Url, UriKind.Absolute, out var uri)
            || uri.GetLeftPart(UriPartial.Authority) != target.GetLeftPart(UriPartial.Authority);
    }
}
