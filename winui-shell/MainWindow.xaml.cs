using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Windows.Graphics;

namespace WinUIShell;

public sealed partial class MainWindow : Window
{
    private NativeBridge? _bridge;
    private bool _initialized;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Class Schedule — WinUI 3 + WebView2";
        AppWindow.Resize(new SizeInt32(1080, 720));

        // Window is not a FrameworkElement, so hook Loaded on the root content.
        ((FrameworkElement)Content).Loaded += async (_, _) => await InitWebViewAsync();
    }

    private async Task InitWebViewAsync()
    {
        if (_initialized) return;
        _initialized = true;

        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WinUIShell", "WebView2");

        var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, userDataFolder, null);
        await WebView.EnsureCoreWebView2Async(environment);

        var core = WebView.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsStatusBarEnabled = false;

        // Serve the existing Electron web content (resources/app) as https://app.local/...
        // so relative css/js/font paths keep working without a file:// origin.
        var appContent = FindAppContentFolder();
        if (appContent is not null)
        {
            core.SetVirtualHostNameToFolderMapping(
                "app.local", appContent, CoreWebView2HostResourceAccessKind.Allow);
        }

        // Serve the shell's own demo page as https://demo.local/...
        core.SetVirtualHostNameToFolderMapping(
            "demo.local", Path.Combine(AppContext.BaseDirectory, "web"),
            CoreWebView2HostResourceAccessKind.Allow);

        // Native bridge: web -> window.chrome.webview.postMessage -> WebMessageReceived
        _bridge = new NativeBridge(core, this);

        // Demo of host -> web push events: broadcast power status every 15 s.
        var timer = DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(15);
        timer.Tick += (_, _) => _bridge.PushEvent("power.updated", NativeBridge.QueryPowerStatus());
        timer.Start();

        // `--app` loads the real class-schedule UI; default is the bridge demo page.
        var args = Environment.GetCommandLineArgs();
        core.Navigate(args.Contains("--app") && appContent is not null
            ? "https://app.local/index.html"
            : "https://demo.local/bridge-demo.html");
    }

    private static string? FindAppContentFolder()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir is not null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "resources", "app");
            if (File.Exists(Path.Combine(candidate, "index.html")))
                return candidate;
        }
        return null;
    }
}
