using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace WinUIShell;

/// <summary>
/// JSON bridge between the web layer and native Windows APIs.
///
///   web -> host (window.chrome.webview.postMessage):
///       { "id": 1, "action": "power.status", "payload": { ... } }
///   host -> web response (PostWebMessageAsJson):
///       { "id": 1, "ok": true,  "result": { ... } }
///       { "id": 1, "ok": false, "error": "..." }
///   host -> web push event (no id):
///       { "event": "power.updated", "data": { ... } }
///
/// Handlers run on the UI thread; UI-bound APIs (AppWindow, pickers, HWND-based
/// P/Invoke) work directly. The web side helper lives in web/nativeBridge.js.
/// </summary>
public sealed class NativeBridge
{
    private readonly CoreWebView2 _webview;
    private readonly Window _window;
    private readonly Dictionary<string, Func<JsonElement, Task<object?>>> _handlers;

    public NativeBridge(CoreWebView2 webview, Window window)
    {
        _webview = webview;
        _window = window;

        _handlers = new(StringComparer.Ordinal)
        {
            ["host.info"]             = HostInfoAsync,
            ["host.messageBox"]       = ShowMessageBoxAsync,
            ["power.status"]          = _ => Task.FromResult<object?>(QueryPowerStatus()),
            ["window.control"]        = WindowControlAsync,
            ["window.setAlwaysOnTop"] = SetAlwaysOnTopAsync,
            ["window.setClickThrough"] = SetClickThroughAsync,
            ["dialog.pickFile"]       = PickFileAsync,
            ["file.read"]             = ReadFileAsync,
            ["file.write"]            = WriteFileAsync,
            ["shell.openExternal"]    = OpenExternalAsync,
        };

        webview.WebMessageReceived += OnWebMessageReceived;
    }

    // ---------- inbound ----------

    private sealed record BridgeRequest(long Id, string? Action, JsonElement Payload);

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        BridgeRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<BridgeRequest>(args.WebMessageAsJson);
        }
        catch (JsonException)
        {
            return; // not a bridge message
        }
        if (request?.Action is null) return;

        var payload = request.Payload.ValueKind == JsonValueKind.Object
            ? request.Payload
            : JsonSerializer.Deserialize<JsonElement>("{}");

        object? result = null;
        string? error = null;
        try
        {
            if (!_handlers.TryGetValue(request.Action, out var handler))
                throw new InvalidOperationException($"Unknown action '{request.Action}'.");
            result = await handler(payload);
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }

        try
        {
            Post(new Dictionary<string, object?>
            {
                ["id"] = request.Id,
                ["ok"] = error is null,
                ["result"] = result,
                ["error"] = error,
            });
        }
        catch
        {
            // The window may already be gone (e.g. window.control = close).
        }
    }

    // ---------- outbound ----------

    public void PushEvent(string eventName, object? data) =>
        Post(new Dictionary<string, object?> { ["event"] = eventName, ["data"] = data });

    private void Post(object message) =>
        _webview.PostWebMessageAsJson(JsonSerializer.Serialize(message));

    // ---------- handlers ----------

    private Task<object?> HostInfoAsync(JsonElement _)
    {
        return Task.FromResult<object?>(new
        {
            os = Environment.OSVersion.VersionString,
            machine = Environment.MachineName,
            user = Environment.UserName,
            is64BitProcess = Environment.Is64BitProcess,
            dotnet = Environment.Version.ToString(),
            webView2 = CoreWebView2Environment.GetAvailableBrowserVersionString(),
            isDarkMode = IsDarkMode(),
        });
    }

    private Task<object?> ShowMessageBoxAsync(JsonElement payload)
    {
        // Classic user32 P/Invoke; parented to this window's HWND.
        var text = payload.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "";
        var caption = payload.TryGetProperty("caption", out var c) ? c.GetString() ?? "Message" : "Message";
        MessageBoxW(WindowHandle(), text, caption, MB_OK | MB_ICONINFORMATION);
        return Task.FromResult<object?>(null);
    }

    private Task<object?> WindowControlAsync(JsonElement payload)
    {
        // Mirrors the Electron app's ipcMain 'window-control' channel,
        // using classic user32 window management.
        var action = payload.TryGetProperty("action", out var a) ? a.GetString() : null;
        switch (action)
        {
            case "minimize":
                ShowWindowAsync(WindowHandle(), SW_MINIMIZE);
                break;
            case "toggle-maximize":
                ShowWindowAsync(WindowHandle(), IsZoomed(WindowHandle()) ? SW_RESTORE : SW_MAXIMIZE);
                break;
            case "close":
                _window.Close();
                return Task.FromResult<object?>(null);
            default:
                throw new ArgumentException($"Unknown window-control action '{action}'.");
        }
        return Task.FromResult<object?>(new { maximized = IsZoomed(WindowHandle()) });
    }

    private Task<object?> SetAlwaysOnTopAsync(JsonElement payload)
    {
        var enabled = payload.TryGetProperty("enabled", out var e) && e.GetBoolean();
        if (GetAppWindow().Presenter is OverlappedPresenter presenter)
            presenter.IsAlwaysOnTop = enabled;
        return Task.FromResult<object?>(new { enabled });
    }

    private Task<object?> SetClickThroughAsync(JsonElement payload)
    {
        // Equivalent of Electron's setIgnoreMouseEvents(true): make the window
        // transparent to mouse input via WS_EX_TRANSPARENT | WS_EX_LAYERED.
        var enabled = payload.TryGetProperty("enabled", out var e) && e.GetBoolean();
        var hwnd = WindowHandle();
        var exStyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
        exStyle = enabled
            ? exStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT
            : exStyle & ~(WS_EX_LAYERED | WS_EX_TRANSPARENT);
        SetWindowLongW(hwnd, GWL_EXSTYLE, exStyle);
        return Task.FromResult<object?>(new { enabled });
    }

    private async Task<object?> PickFileAsync(JsonElement payload)
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WindowHandle());
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary;

        if (payload.TryGetProperty("extensions", out var exts) && exts.ValueKind == JsonValueKind.Array)
        {
            foreach (var ext in exts.EnumerateArray())
                picker.FileTypeFilter.Add(ext.GetString() ?? ".json");
        }
        else
        {
            picker.FileTypeFilter.Add(".json");
            picker.FileTypeFilter.Add(".txt");
        }

        var file = await picker.PickSingleFileAsync();
        return file is null ? null : new { name = file.Name, path = file.Path };
    }

    private static readonly string SandboxRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "WinUIShell", "bridge-files");

    private async Task<object?> ReadFileAsync(JsonElement payload)
    {
        var path = ResolveSandboxed(payload);
        return new { path, content = await File.ReadAllTextAsync(path) };
    }

    private async Task<object?> WriteFileAsync(JsonElement payload)
    {
        var path = ResolveSandboxed(payload);
        var content = payload.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, content);
        return new { path, bytes = new FileInfo(path).Length };
    }

    private Task<object?> OpenExternalAsync(JsonElement payload)
    {
        var url = payload.TryGetProperty("url", out var u) ? u.GetString() : null;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Only absolute http(s) URLs are allowed.");
        Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        return Task.FromResult<object?>(new { opened = uri.ToString() });
    }

    // ---------- helpers ----------

    private nint WindowHandle() => WinRT.Interop.WindowNative.GetWindowHandle(_window);

    private AppWindow GetAppWindow()
    {
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(WindowHandle());
        return AppWindow.GetFromWindowId(windowId);
    }

    private static string ResolveSandboxed(JsonElement payload)
    {
        if (!payload.TryGetProperty("path", out var p))
            throw new ArgumentException("payload.path is required.");
        var requested = Path.GetFullPath(p.GetString() ?? "");
        var root = Path.GetFullPath(SandboxRoot) + Path.DirectorySeparatorChar;
        if (!requested.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException($"Only paths under {SandboxRoot} are allowed.");
        return requested;
    }

    private static bool IsDarkMode()
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
    }

    public static object QueryPowerStatus()
    {
        var status = new SYSTEM_POWER_STATUS();
        if (!GetSystemPowerStatus(ref status))
            throw new InvalidOperationException("GetSystemPowerStatus failed.");
        return new
        {
            acOnline = status.ACLineStatus == 1,
            batteryPercent = status.BatteryLifePercent == 255 ? null : (int?)status.BatteryLifePercent,
            secondsRemaining = status.BatteryLifeTime == -1 ? null : (int?)status.BatteryLifeTime,
        };
    }

    // ---------- native interop ----------

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const uint MB_OK = 0x0;
    private const uint MB_ICONINFORMATION = 0x40;
    private const int SW_MINIMIZE = 6;
    private const int SW_MAXIMIZE = 3;
    private const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte Reserved1;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(nint hWnd, string text, string caption, uint type);

    [DllImport("user32.dll")]
    private static extern int GetWindowLongW(nint hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern int SetWindowLongW(nint hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(nint hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsZoomed(nint hWnd);

    [DllImport("kernel32.dll")]
    private static extern bool GetSystemPowerStatus(ref SYSTEM_POWER_STATUS lpSystemPowerStatus);
}
