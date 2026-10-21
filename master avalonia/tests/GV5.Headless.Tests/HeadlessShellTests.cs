using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;
using GV5.App.Presentation;
using GV5.App.Navigation;
using GV5.App.ViewModels;
using GV5.App.Views;
using GV5.Application.Contracts;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Geometry;
using GV5.Modules.Customizador;
using GV5.Modules.Customizador.ViewModels;
using GV5.Modules.Fabricador;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Rendering;
using SkiaSharp;
using System.Security.Cryptography;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class HeadlessShellTests
{
    [AvaloniaFact]
    public async Task Shell_Navigates_Between_Real_Module_ViewModels_Without_Desktop()
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
        await vm.NavigateCommand.ExecuteAsync(customizer.CommandParameter as string);

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
    public async Task RenderedFrameAdapter_PresentsEnginePixels_WithoutDecodingDuringViewRender()
    {
        using var provider = new TestRenderAssetProvider(CreateFourColorPng());
        var assetId = AssetId.New();
        var layer = new RenderLayer(
            RenderLayerId.New(),
            assetId,
            new Rect2D(0, 0, 2, 2),
            new Transform2D(new Point2D(1, 1), new Point2D(1, 1), 0, Point2D.Zero),
            1,
            RenderBlendMode.Normal,
            0);
        var scene = new RenderScene(SceneId.New(), 4, 4, [layer]);
        using var frame = await new SkiaRenderer(provider).RenderAsync(scene, TestContext.Current.CancellationToken);
        var presenter = new AvaloniaRenderedFrameAdapter();
        var offThreadException = await Task.Run(() => Record.Exception(() => presenter.CreateBitmap(frame)));
        Assert.IsType<InvalidOperationException>(offThreadException);
        using var bitmap = presenter.CreateBitmap(frame);
        var window = new Window
        {
            Width = 4,
            Height = 4,
            Content = new Image { Source = bitmap, Width = 4, Height = 4, Stretch = Stretch.None }
        };

        try
        {
            window.Show();
            using var captured = window.CaptureRenderedFrame()
                ?? throw new InvalidOperationException("Avalonia Headless did not capture the presentation window.");
            using var png = new MemoryStream();
            captured.Save(png, PngBitmapEncoderOptions.Default);
            png.Position = 0;
            using var capturedPixels = SKBitmap.Decode(png)
                ?? throw new InvalidDataException("Could not decode the headless presentation capture.");

            Assert.Equal(new PixelSize(4, 4), bitmap.PixelSize);
            Assert.Equal(SKColors.Red, capturedPixels.GetPixel(1, 1));
            Assert.Equal(SKColors.Green, capturedPixels.GetPixel(2, 1));
            Assert.Equal(SKColors.Blue, capturedPixels.GetPixel(1, 2));
            Assert.Equal(SKColors.Yellow, capturedPixels.GetPixel(2, 2));
            Assert.Equal(1, provider.AcquireCount);
            Assert.Equal(0, provider.Cache.Metrics.ActiveLeaseCount);
        }
        finally
        {
            window.Close();
        }
    }

    [AvaloniaFact]
    public async Task EditorOverlays_Render_Above_EngineFrame_Without_Changing_It()
    {
        using var provider = new TestRenderAssetProvider(CreateFourColorPng());
        var layer = new RenderLayer(
            RenderLayerId.New(),
            AssetId.New(),
            new Rect2D(0, 0, 2, 2),
            new Transform2D(new Point2D(1, 1), new Point2D(1, 1), 0, Point2D.Zero),
            1,
            RenderBlendMode.Normal,
            0);
        var scene = new RenderScene(SceneId.New(), 4, 4, [layer]);
        using var frame = await new SkiaRenderer(provider).RenderAsync(scene, TestContext.Current.CancellationToken);
        var enginePixelsBefore = HashFrame(frame.Bitmap);
        var bitmap = new AvaloniaRenderedFrameAdapter().CreateBitmap(frame);
        var image = new Image { Source = bitmap, Width = 4, Height = 4, Stretch = Stretch.None };
        var overlay = new RenderedFrameOverlayControl { Width = 4, Height = 4, FrameSize = new Size(4, 4) };
        var canvas = new Grid { Width = 4, Height = 4 };
        canvas.Children.Add(image);
        canvas.Children.Add(overlay);
        var window = new Window { Width = 4, Height = 4, Content = canvas };

        try
        {
            window.Show();
            using var baseCapture = CapturePixels(window);
            SaveOverlayCapture(baseCapture, "base.png");

            overlay.Overlay = new EditorOverlayState(
                showGrid: false,
                gridSpacing: 1,
                selectionBounds: new Rect(0.5, 0.5, 3, 3),
                pivots: [],
                CreateOverlayStyle());
            using var selectionCapture = CapturePixels(window);
            SaveOverlayCapture(selectionCapture, "selection.png");
            Assert.True(CountChangedPixels(baseCapture, selectionCapture) > 0, "Selection bounds were not drawn over the frame.");

            overlay.Overlay = new EditorOverlayState(
                showGrid: true,
                gridSpacing: 2,
                selectionBounds: null,
                pivots: [],
                CreateOverlayStyle());
            using var gridCapture = CapturePixels(window);
            SaveOverlayCapture(gridCapture, "grid.png");
            Assert.True(CountChangedPixels(baseCapture, gridCapture) > 0, "Grid lines were not drawn over the frame.");

            overlay.Overlay = new EditorOverlayState(
                showGrid: false,
                gridSpacing: 1,
                selectionBounds: null,
                pivots: [new Point(2.5, 2.5)],
                CreateOverlayStyle());
            using var pivotCapture = CapturePixels(window);
            SaveOverlayCapture(pivotCapture, "pivots.png");
            Assert.Equal(SKColors.White, pivotCapture.GetPixel(2, 2));
            Assert.True(CountChangedPixels(baseCapture, pivotCapture) > 0, "Pivot handles were not drawn over the frame.");

            Assert.Equal(enginePixelsBefore, HashFrame(frame.Bitmap));
            Assert.Equal(1, provider.AcquireCount);
            Assert.Equal(0, provider.Cache.Metrics.ActiveLeaseCount);
            Assert.False(overlay.IsHitTestVisible, "The visual overlay must not intercept canvas input.");
        }
        finally
        {
            window.Close();
            bitmap.Dispose();
        }
    }

    [Fact]
    public void EditorOverlayState_Copies_Pivot_Collection_And_Rejects_Invalid_Grid()
    {
        var pivots = new List<Point> { new(3, 4) };
        var state = new EditorOverlayState(false, 1, null, pivots, CreateOverlayStyle());
        pivots.Add(new Point(5, 6));

        Assert.Single(state.Pivots);
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new EditorOverlayState(true, 0, null, [], CreateOverlayStyle()));
    }

    [AvaloniaFact]
    public async Task LatestPreviewRenderer_Cancels_Older_Request_And_Drops_Late_Frame()
    {
        using var provider = new TestRenderAssetProvider(CreateFourColorPng());
        var delayedRenderer = new DelayedPreviewRenderer(new SkiaRenderer(provider));
        var oldScene = new RenderScene(SceneId.New(), 4, 4, []);
        delayedRenderer.Hold(oldScene);
        using var coordinator = new LatestPreviewRenderer(delayedRenderer);
        var publishedVersions = new List<long>();

        var oldRequest = coordinator.RequestAsync(oldScene, (version, _) => publishedVersions.Add(version));
        await delayedRenderer.WaitUntilHeldAsync();

        var currentScene = new RenderScene(SceneId.New(), 4, 4, []);
        var currentRequest = coordinator.RequestAsync(currentScene, (version, _) => publishedVersions.Add(version));
        var currentResult = await currentRequest.WaitAsync(TimeSpan.FromSeconds(10));
        delayedRenderer.ReleaseHeldFrame();
        var oldResult = await oldRequest.WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Equal(PreviewRenderStatus.Published, currentResult.Status);
        Assert.Equal(PreviewRenderStatus.Superseded, oldResult.Status);
        Assert.True(delayedRenderer.HeldRequestObservedCancellation);
        Assert.Equal([currentResult.Version], publishedVersions);
        Assert.IsType<ObjectDisposedException>(Record.Exception(() => delayedRenderer.HeldFrame!.Bitmap));
        Assert.Equal(0, provider.Cache.Metrics.ActiveLeaseCount);
    }

    [AvaloniaFact]
    public async Task LatestPreviewRenderer_Drops_Explicitly_Canceled_Request()
    {
        using var provider = new TestRenderAssetProvider(CreateFourColorPng());
        var delayedRenderer = new DelayedPreviewRenderer(new SkiaRenderer(provider));
        var scene = new RenderScene(SceneId.New(), 4, 4, []);
        delayedRenderer.Hold(scene);
        using var coordinator = new LatestPreviewRenderer(delayedRenderer);
        using var cancellation = new CancellationTokenSource();
        var published = false;
        var request = coordinator.RequestAsync(scene, (_, _) => published = true, cancellation.Token);
        await delayedRenderer.WaitUntilHeldAsync();

        cancellation.Cancel();
        delayedRenderer.ReleaseHeldFrame();
        var result = await request.WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Equal(PreviewRenderStatus.Canceled, result.Status);
        Assert.False(published);
        Assert.True(delayedRenderer.HeldRequestObservedCancellation);
        Assert.IsType<ObjectDisposedException>(Record.Exception(() => delayedRenderer.HeldFrame!.Bitmap));
        Assert.Equal(0, provider.Cache.Metrics.ActiveLeaseCount);
    }

    private static EditorOverlayStyle CreateOverlayStyle() => new(
        gridColor: Color.FromRgb(0, 255, 255),
        selectionColor: Color.FromRgb(255, 0, 255),
        pivotColor: Color.FromRgb(255, 255, 255),
        strokeThickness: 1,
        pivotRadius: 1.25);

    private static SKBitmap CapturePixels(Window window)
    {
        using var capture = window.CaptureRenderedFrame()
            ?? throw new InvalidOperationException("Avalonia Headless did not capture the overlay window.");
        using var png = new MemoryStream();
        capture.Save(png, PngBitmapEncoderOptions.Default);
        png.Position = 0;
        return SKBitmap.Decode(png)
            ?? throw new InvalidDataException("Could not decode the overlay capture.");
    }

    private static int CountChangedPixels(SKBitmap first, SKBitmap second)
    {
        Assert.Equal(first.Width, second.Width);
        Assert.Equal(first.Height, second.Height);
        var changed = 0;
        for (var y = 0; y < first.Height; y++)
        for (var x = 0; x < first.Width; x++)
        {
            if (first.GetPixel(x, y) != second.GetPixel(x, y))
            {
                changed++;
            }
        }

        return changed;
    }

    private static string HashFrame(SKBitmap bitmap)
    {
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Could not encode the rendered frame for immutability verification.");
        return Convert.ToHexString(SHA256.HashData(encoded.ToArray()));
    }

    private static void SaveOverlayCapture(SKBitmap bitmap, string fileName)
    {
        var folder = Path.Combine(AppContext.BaseDirectory, "TestResults", "Overlays");
        Directory.CreateDirectory(folder);
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Could not encode the overlay evidence capture.");
        File.WriteAllBytes(Path.Combine(folder, fileName), encoded.ToArray());
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

    private static byte[] CreateFourColorPng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(2, 2, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.SetPixel(0, 0, SKColors.Red);
        bitmap.SetPixel(1, 0, SKColors.Green);
        bitmap.SetPixel(0, 1, SKColors.Blue);
        bitmap.SetPixel(1, 1, SKColors.Yellow);
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Could not encode the headless renderer fixture.");
        return encoded.ToArray();
    }

    private sealed class TestRenderAssetProvider : IRenderAssetProvider, IDisposable
    {
        private readonly byte[] _png;
        private readonly AssetImageCacheKey _key;

        public AssetBitmapCache Cache { get; } = new(1024 * 1024);
        public int AcquireCount { get; private set; }

        public TestRenderAssetProvider(byte[] png)
        {
            _png = png;
            _key = AssetImageCacheKey.Create(Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(), decoderVersion: 1);
        }

        public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            Assert.True(assetId.IsValid);
            AcquireCount++;
            var result = await Cache.AcquireAsync(_key, DecodeAsync, cancellationToken);
            Assert.True(result.IsSuccess, result.Error?.Message);
            return result.Lease!;
        }

        public void Dispose() => Cache.Dispose();

        private async Task<AssetImageDecodeResult> DecodeAsync(CancellationToken cancellationToken)
        {
            await using var stream = new MemoryStream(_png, writable: false);
            return await new AssetImageDecoder().DecodeAsync(stream, cancellationToken);
        }
    }

    private sealed class DelayedPreviewRenderer(SkiaRenderer renderer) : IRenderSceneRenderer
    {
        private RenderScene? _heldScene;
        private readonly TaskCompletionSource _heldFrameReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _releaseHeldFrame = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _heldRequestObservedCancellation;

        public RenderedFrame? HeldFrame { get; private set; }
        public bool HeldRequestObservedCancellation => Volatile.Read(ref _heldRequestObservedCancellation) != 0;

        public void Hold(RenderScene scene) => _heldScene = scene;

        public Task WaitUntilHeldAsync() => _heldFrameReady.Task.WaitAsync(TimeSpan.FromSeconds(10));

        public void ReleaseHeldFrame() => _releaseHeldFrame.TrySetResult();

        public async Task<RenderedFrame> RenderAsync(RenderScene scene, CancellationToken cancellationToken = default)
        {
            var frame = await renderer.RenderAsync(scene, cancellationToken);
            if (ReferenceEquals(scene, _heldScene))
            {
                HeldFrame = frame;
                _heldFrameReady.TrySetResult();
                await _releaseHeldFrame.Task; // Intentionally completes despite cancellation to exercise version rejection.
                if (cancellationToken.IsCancellationRequested)
                {
                    Volatile.Write(ref _heldRequestObservedCancellation, 1);
                }
            }

            return frame;
        }
    }
}
