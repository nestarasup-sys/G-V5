using System.ComponentModel;
using System.Collections.ObjectModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Rendering;
using System.Runtime.InteropServices;

namespace GV5.Modules.Fabricador.Views;

public partial class FaceWorkspacePanel : UserControl
{
    private FaceWorkspaceViewModel? _viewModel;
    private readonly ObservableCollection<FaceSheetPreviewTile> _previewTiles = [];
    private WriteableBitmap? _composedPreviewBitmap;

    public FaceWorkspacePanel()
    {
        InitializeComponent();
        FacePiecesControl.ItemsSource = _previewTiles;
        DetachedFromVisualTree += (_, _) => ClearBitmaps();
        DetachedFromVisualTree += (_, _) => ClearComposedPreview();
        AttachedToVisualTree += (_, _) => UpdateImages();
        AttachedToVisualTree += (_, _) => UpdateComposedPreviewImage();
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_viewModel is not null) _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel = DataContext as FaceWorkspaceViewModel;
        if (_viewModel is not null) _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        UpdateImages();
        UpdateComposedPreviewImage();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not (nameof(FaceWorkspaceViewModel.Preview)
            or nameof(FaceWorkspaceViewModel.ComposedPreviewFrame))) return;
        if (Dispatcher.UIThread.CheckAccess())
        {
            if (e.PropertyName == nameof(FaceWorkspaceViewModel.Preview)) UpdateImages();
            if (e.PropertyName == nameof(FaceWorkspaceViewModel.ComposedPreviewFrame)) UpdateComposedPreviewImage();
        }
        else Dispatcher.UIThread.Post(() =>
        {
            if (e.PropertyName == nameof(FaceWorkspaceViewModel.Preview)) UpdateImages();
            if (e.PropertyName == nameof(FaceWorkspaceViewModel.ComposedPreviewFrame)) UpdateComposedPreviewImage();
        });
    }

    private void UpdateImages()
    {
        ClearBitmaps();
        if (_viewModel?.Preview is not { } preview) return;

        foreach (var piece in preview.Pieces)
        {
            var label = GetPieceLabel(piece.PartKind, piece.Side, piece.Index);
            _previewTiles.Add(new FaceSheetPreviewTile(label, $"{piece.Width}×{piece.Height}", CreateBitmap(piece.Preview)));
        }
    }

    private void ClearBitmaps()
    {
        FacePiecesControl.ItemsSource = null;
        foreach (var tile in _previewTiles) tile.Bitmap.Dispose();
        _previewTiles.Clear();
        FacePiecesControl.ItemsSource = _previewTiles;
    }

    private void UpdateComposedPreviewImage()
    {
        ClearComposedPreview();
        if (_viewModel?.ComposedPreviewFrame is not { } frame) return;
        _composedPreviewBitmap = CreateBitmap(frame);
        ComposedFacePreviewImage.Source = _composedPreviewBitmap;
    }

    private void ClearComposedPreview()
    {
        ComposedFacePreviewImage.Source = null;
        _composedPreviewBitmap?.Dispose();
        _composedPreviewBitmap = null;
    }

    private static string GetPieceLabel(FaceSheetPartKind kind, FaceSheetSide? side, int index)
    {
        var label = kind switch
        {
            FaceSheetPartKind.Eye => "Olho",
            FaceSheetPartKind.Pupil => "Pupila",
            FaceSheetPartKind.ClosedEye => "Olho fechado",
            FaceSheetPartKind.Eyebrow => "Sobrancelha",
            FaceSheetPartKind.Nose => "Nariz",
            FaceSheetPartKind.Mouth => "Boca",
            _ => "Componente facial"
        };
        if (side is { } faceSide) return $"{label} {(faceSide == FaceSheetSide.Left ? "esquerdo" : "direito")}";
        return $"{label} {index + 1:00}";
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
                throw new InvalidOperationException("A prévia facial possui uma linha RGBA inválida.");
            var pixels = source.GetPixels();
            if (pixels == IntPtr.Zero || framebuffer.Address == IntPtr.Zero)
                throw new InvalidOperationException("Não foi possível alocar os pixels da prévia facial.");
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

    private static WriteableBitmap CreateBitmap(RenderedFrame frame)
    {
        var source = frame.Bitmap;
        var bitmap = new WriteableBitmap(new PixelSize(source.Width, source.Height), new Vector(96, 96),
            PixelFormats.Rgba8888, AlphaFormat.Premul);
        try
        {
            using var framebuffer = bitmap.Lock();
            var bytesPerRow = checked(source.Width * 4);
            if (source.RowBytes < bytesPerRow || framebuffer.RowBytes < bytesPerRow)
                throw new InvalidOperationException("A prévia facial renderizada possui uma linha RGBA inválida.");
            var pixels = source.GetPixels();
            if (pixels == IntPtr.Zero || framebuffer.Address == IntPtr.Zero)
                throw new InvalidOperationException("Não foi possível alocar os pixels da prévia facial renderizada.");
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

public sealed record FaceSheetPreviewTile(string Label, string Dimensions, WriteableBitmap Bitmap);
