using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using GV5.Modules.Fabricador.ViewModels;
using System.Runtime.InteropServices;

namespace GV5.Modules.Fabricador.Views;

public partial class HairWorkspacePanel : UserControl
{
    private HairWorkspaceViewModel? _viewModel;
    private WriteableBitmap? _posteriorBitmap;
    private WriteableBitmap? _traseiroBitmap;

    public HairWorkspacePanel() => InitializeComponent();

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_viewModel is not null) _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel = DataContext as HairWorkspaceViewModel;
        if (_viewModel is not null) _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        UpdateImages();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not (nameof(HairWorkspaceViewModel.Preview)
            or nameof(HairWorkspaceViewModel.PosteriorTint)
            or nameof(HairWorkspaceViewModel.TraseiroTint))) return;
        if (Avalonia.Threading.Dispatcher.UIThread.CheckAccess()) UpdateImages();
        else Avalonia.Threading.Dispatcher.UIThread.Post(UpdateImages);
    }

    private void UpdateImages()
    {
        _posteriorBitmap?.Dispose();
        _traseiroBitmap?.Dispose();
        _posteriorBitmap = null;
        _traseiroBitmap = null;
        if (_viewModel?.Preview is not { } preview)
        {
            PosteriorImage.Source = null;
            TraseiroImage.Source = null;
            return;
        }

        _posteriorBitmap = CreateBitmap(_viewModel.PosteriorTint?.Image ?? preview.PosteriorPreview);
        _traseiroBitmap = CreateBitmap(_viewModel.TraseiroTint?.Image ?? preview.TraseiroPreview);
        PosteriorImage.Source = _posteriorBitmap;
        TraseiroImage.Source = _traseiroBitmap;
    }

    private static WriteableBitmap CreateBitmap(DecodedAssetImage decoded)
    {
        var source = decoded.Bitmap;
        var bitmap = new WriteableBitmap(new PixelSize(source.Width, source.Height), new Vector(96, 96),
            PixelFormats.Rgba8888, AlphaFormat.Unpremul);
        try
        {
            using var framebuffer = bitmap.Lock();
            var bytesPerRow = checked(source.Width * 4);
            if (source.RowBytes < bytesPerRow || framebuffer.RowBytes < bytesPerRow)
                throw new InvalidOperationException("A prévia de cabelo possui uma linha RGBA inválida.");
            var pixels = source.GetPixels();
            if (pixels == IntPtr.Zero || framebuffer.Address == IntPtr.Zero)
                throw new InvalidOperationException("Não foi possível alocar os pixels da prévia de cabelo.");
            var row = new byte[bytesPerRow];
            for (var y = 0; y < source.Height; y++)
            {
                Marshal.Copy(IntPtr.Add(pixels, checked(y * source.RowBytes)), row, 0, row.Length);
                Marshal.Copy(row, 0, IntPtr.Add(framebuffer.Address, checked(y * framebuffer.RowBytes)), row.Length);
            }
            return bitmap;
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }
}
