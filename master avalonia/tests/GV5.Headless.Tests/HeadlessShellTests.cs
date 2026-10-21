using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;
using GV5.App.Navigation;
using GV5.App.ViewModels;
using GV5.App.Views;
using GV5.Application.Contracts;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
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
        using var data = new TestDatabaseFixture();
        var vm = MakeMainViewModel(data);
        var window = OpenHeadlessShell(vm);
        try
        {
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
        finally
        {
            window.Close();
        }
    }

    [AvaloniaFact]
    public void Headless_Skia_Captures_A_Real_Png_Without_Desktop_Window()
    {
        using var data = new TestDatabaseFixture();
        var window = OpenHeadlessShell(MakeMainViewModel(data));
        try
        {
        using var bitmap = window.CaptureRenderedFrame();
        Assert.NotNull(bitmap);
        Assert.True(bitmap.PixelSize.Width > 0);
        Assert.True(bitmap.PixelSize.Height > 0);

        // Confirm the real shell resolves its DynamicResource-backed navigation style.
        var fabricator = window.GetVisualDescendants()
            .OfType<Button>()
            .Single(button => string.Equals(button.Content as string, "Fabricador", StringComparison.Ordinal));
        var background = Assert.IsType<SolidColorBrush>(fabricator.Background);
        Assert.Equal(Color.Parse("#211B2B"), background.Color);

        using var png = new MemoryStream();
        bitmap.Save(png, PngBitmapEncoderOptions.Default);
        Assert.True(png.Length > 8);

        // Verify PNG signature, not just that we received a byte array.
        var signature = png.ToArray().AsSpan(0, 8).ToArray();
        Assert.Equal(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, signature);

        // Artifacts stay under ignored bin/Release or bin/Debug, never in the user's profile.
        var outputFolder = Path.Combine(AppContext.BaseDirectory, "TestResults", "headless");
        Directory.CreateDirectory(outputFolder);
        File.WriteAllBytes(Path.Combine(outputFolder, "shell.png"), png.ToArray());
        }
        finally
        {
            window.Close();
        }
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

    private static MainViewModel MakeMainViewModel(TestDatabaseFixture data)
    {
        var catalog = new ModuleRouteCatalog(new[] { FabricadorModule.Route, CustomizadorModule.Route });
        return new MainViewModel(catalog, new FakePageFactory(data.CreateFabricadorViewModel));
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

    private sealed class FakePageFactory(Func<FabricadorViewModel> createFabricador) : IModulePageFactory
    {
        public IModulePageViewModel Create(ModuleRoute route) => route.Id switch
        {
            "fabricador" => createFabricador(),
            "customizador" => new CustomizadorViewModel(),
            _ => throw new InvalidOperationException($"Unexpected route: {route.Id}")
        };
    }

    private sealed class TestDatabaseFixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), $"gv5-headless-{Guid.NewGuid():N}");
        private readonly SqliteDatabase _database;

        public TestDatabaseFixture()
        {
            _database = new SqliteDatabase(new AppDataPaths(_root));
        }

        public FabricadorViewModel CreateFabricadorViewModel() => new(
            new SqliteModelDraftRepository(_database),
            new SqliteMigrationRunner(_database, [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration()]));

        public void Dispose()
        {
            _database.Dispose();
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }
        }
    }
}
