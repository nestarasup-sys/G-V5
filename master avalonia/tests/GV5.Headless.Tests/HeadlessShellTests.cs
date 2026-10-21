using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using GV5.App.Navigation;
using GV5.App.ViewModels;
using GV5.App.Views;
using GV5.Application.Contracts;
using GV5.Modules.Customizador;
using GV5.Modules.Customizador.ViewModels;
using GV5.Modules.Fabricador;
using GV5.Modules.Fabricador.ViewModels;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class HeadlessShellTests
{
    [AvaloniaFact]
    public void Shell_Navigates_Between_Real_Module_ViewModels_Without_Desktop()
    {
        var vm = MakeMainViewModel();
        using var window = OpenHeadlessShell(vm);

        Assert.Equal("fabricador", vm.ActiveRoute.Id);
        Assert.IsType<FabricadorViewModel>(vm.CurrentPage);

        // Obtain the actual navigation button from Avalonia's rendered control tree.
        var customizer = window.GetVisualDescendants()
            .OfType<Button>()
            .Single(button => string.Equals(button.Content as string, "Customizador", StringComparison.Ordinal));

        Assert.NotNull(customizer.Command);
        Assert.Equal("customizador", customizer.CommandParameter as string);
        Assert.True(customizer.Command!.CanExecute(customizer.CommandParameter));
        customizer.Command.Execute(customizer.CommandParameter);

        Assert.Null(vm.NavigationError);
        Assert.Equal("customizador", vm.ActiveRoute.Id);
        Assert.IsType<CustomizadorViewModel>(vm.CurrentPage);
    }

    [AvaloniaFact]
    public void Headless_Skia_Captures_A_Real_Png_Without_Desktop_Window()
    {
        using var window = OpenHeadlessShell(MakeMainViewModel());

        using var bitmap = window.CaptureRenderedFrame();
        Assert.NotNull(bitmap);
        Assert.True(bitmap.PixelSize.Width > 0);
        Assert.True(bitmap.PixelSize.Height > 0);

        using var png = new MemoryStream();
        bitmap.Save(png);
        Assert.True(png.Length > 8);

        // Verify PNG signature, not just that we received a byte array.
        var signature = png.ToArray().AsSpan(0, 8).ToArray();
        Assert.Equal(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, signature);

        // Artifacts stay under ignored bin/Release or bin/Debug, never in the user's profile.
        var outputFolder = Path.Combine(AppContext.BaseDirectory, "TestResults", "headless");
        Directory.CreateDirectory(outputFolder);
        File.WriteAllBytes(Path.Combine(outputFolder, "shell.png"), png.ToArray());
    }

    [AvaloniaFact]
    public void TextInput_Is_Simulated_In_Memory()
    {
        var text = new TextBox();
        var window = new Window { Width = 400, Height = 180, Content = text };
        try
        {
            window.Show(); // Headless window only; not an OS HWND.
            text.Focus();
            window.KeyTextInput("G-V5 HEADLESS");

            Assert.Equal("G-V5 HEADLESS", text.Text);
        }
        finally
        {
            window.Close();
        }
    }

    private static MainViewModel MakeMainViewModel()
    {
        var catalog = new ModuleRouteCatalog(new[] { FabricadorModule.Route, CustomizadorModule.Route });
        return new MainViewModel(catalog, new FakePageFactory());
    }

    private static MainWindow OpenHeadlessShell(MainViewModel vm)
    {
        var window = new MainWindow
        {
            Width = 1100,
            Height = 700,
            DataContext = vm
        };
        window.Show(); // This Show() is fully in-memory thanks to Avalonia.Headless.
        return window;
    }

    private sealed class FakePageFactory : IModulePageFactory
    {
        public IModulePageViewModel Create(ModuleRoute route) => route.Id switch
        {
            "fabricador" => new FabricadorViewModel(),
            "customizador" => new CustomizadorViewModel(),
            _ => throw new InvalidOperationException($"Unexpected route: {route.Id}")
        };
    }
}
