using Avalonia;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;

[assembly: AvaloniaTestApplication(typeof(GV5.Headless.Tests.TestAppBuilder))]

namespace GV5.Headless.Tests;

/// <summary>
/// Bootstraps the REAL G-V5 App under an in-memory headless platform.
/// No native window, desktop mouse or desktop keyboard is ever created.
/// </summary>
public sealed class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<GV5.App.App>()
            .WithInterFont()
            .UseSkia()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions
            {
                UseHeadlessDrawing = false, // Actual pixels for PNG/golden comparisons.
                Fps = 30
            });
}
