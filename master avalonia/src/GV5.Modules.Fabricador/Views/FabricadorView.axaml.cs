using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Interaction;
using GV5.Geometry;
using System.Runtime.InteropServices;

namespace GV5.Modules.Fabricador.Views;

public partial class FabricadorView : UserControl
{
    private FabricadorViewModel? _viewModel;
    private WriteableBitmap? _previewBitmap;

    public FabricadorView() => InitializeComponent();

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        }

        _viewModel = DataContext as FabricadorViewModel;
        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        }

        ModelCanvas.SceneClicked -= OnCanvasSceneClicked;
        ModelCanvas.SceneClicked += OnCanvasSceneClicked;
        ModelCanvas.TransformGestureStarted = OnCanvasTransformStarted;
        ModelCanvas.TransformGestureMoved = OnCanvasTransformMoved;
        ModelCanvas.TransformGestureCompleted = OnCanvasTransformCompleted;
        ModelCanvas.RigAnchorDragStarted = OnRigAnchorDragStarted;
        ModelCanvas.RigAnchorDragMoved = OnRigAnchorDragMoved;
        ModelCanvas.RigAnchorDragCompleted = OnRigAnchorDragCompleted;
        UpdateCanvasInteractionState();
        UpdatePreviewImage();
        UpdateRenderedModel();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(FabricadorViewModel.RenderedModelFrame))
        {
            if (Dispatcher.UIThread.CheckAccess())
            {
                UpdateRenderedModel();
                UpdateCanvasInteractionState();
            }
            else
            {
                Dispatcher.UIThread.Post(UpdateRenderedModel);
                Dispatcher.UIThread.Post(UpdateCanvasInteractionState);
            }

            return;
        }

        if (e.PropertyName is nameof(FabricadorViewModel.SelectedPartBounds)
            or nameof(FabricadorViewModel.SelectedPartPivot)
            or nameof(FabricadorViewModel.ActiveTool)
            or nameof(FabricadorViewModel.CanEditRig)
            or nameof(FabricadorViewModel.RigJointItems)
            or nameof(FabricadorViewModel.SelectedRigJoint)
            or nameof(FabricadorViewModel.IsPoseWorkspace))
        {
            if (Dispatcher.UIThread.CheckAccess())
            {
                UpdateCanvasInteractionState();
            }
            else
            {
                Dispatcher.UIThread.Post(UpdateCanvasInteractionState);
            }
        }

        if (e.PropertyName != nameof(FabricadorViewModel.ImportPreview))
        {
            return;
        }

        if (Dispatcher.UIThread.CheckAccess())
        {
            UpdatePreviewImage();
        }
        else
        {
            Dispatcher.UIThread.Post(UpdatePreviewImage);
        }
    }

    private void UpdatePreviewImage()
    {
        _previewBitmap?.Dispose();
        _previewBitmap = null;
        if (_viewModel?.ImportPreview is { } preview)
        {
            var source = preview.DisplayImage.Bitmap;
            var bitmap = new WriteableBitmap(
                new PixelSize(source.Width, source.Height),
                new Vector(96, 96),
                PixelFormats.Rgba8888,
                AlphaFormat.Unpremul);
            try
            {
                using var framebuffer = bitmap.Lock();
                var bytesPerRow = checked(source.Width * 4);
                if (source.RowBytes < bytesPerRow || framebuffer.RowBytes < bytesPerRow)
                {
                    throw new InvalidOperationException("A model preview row is shorter than its declared RGBA width.");
                }

                var pixels = source.GetPixels();
                if (pixels == IntPtr.Zero || framebuffer.Address == IntPtr.Zero)
                {
                    throw new InvalidOperationException("A model preview pixel buffer could not be allocated.");
                }

                var row = new byte[bytesPerRow];
                for (var y = 0; y < source.Height; y++)
                {
                    Marshal.Copy(IntPtr.Add(pixels, checked(y * source.RowBytes)), row, 0, row.Length);
                    Marshal.Copy(row, 0, IntPtr.Add(framebuffer.Address, checked(y * framebuffer.RowBytes)), row.Length);
                }

                _previewBitmap = bitmap;
                ModelSourcePreviewImage.Source = bitmap;
            }
            catch
            {
                bitmap.Dispose();
                throw;
            }

            return;
        }

        ModelSourcePreviewImage.Source = null;
    }

    private void UpdateRenderedModel()
    {
        if (_viewModel?.RenderedModelFrame is not { } frame)
        {
            ModelCanvas.Frame = null;
            return;
        }

        var source = frame.Bitmap;
        var bitmap = new WriteableBitmap(
            new PixelSize(source.Width, source.Height),
            new Vector(96, 96),
            PixelFormats.Rgba8888,
            AlphaFormat.Premul);
        try
        {
            using var framebuffer = bitmap.Lock();
            var bytesPerRow = checked(source.Width * 4);
            if (source.RowBytes < bytesPerRow || framebuffer.RowBytes < bytesPerRow)
            {
                throw new InvalidOperationException("A rendered model row is shorter than its declared RGBA width.");
            }

            var pixels = source.GetPixels();
            if (pixels == IntPtr.Zero || framebuffer.Address == IntPtr.Zero)
            {
                throw new InvalidOperationException("A rendered model pixel buffer could not be allocated.");
            }

            var row = new byte[bytesPerRow];
            for (var y = 0; y < source.Height; y++)
            {
                Marshal.Copy(IntPtr.Add(pixels, checked(y * source.RowBytes)), row, 0, row.Length);
                Marshal.Copy(row, 0, IntPtr.Add(framebuffer.Address, checked(y * framebuffer.RowBytes)), row.Length);
            }

            ModelCanvas.Frame = bitmap;
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }

    private void UpdateCanvasInteractionState()
    {
        if (_viewModel is null)
        {
            ModelCanvas.SetSelection(null);
            ModelCanvas.SetTool(FabricatorTool.Select);
            return;
        }

        ModelCanvas.SetSelection(
            _viewModel.SelectedPartBounds,
            _viewModel.SelectedPartPivot,
            showTransformHandles: !_viewModel.IsPoseWorkspace);
        ModelCanvas.SetTool(_viewModel.ActiveTool);
        ModelCanvas.SetRigJoints(
            _viewModel.RigJointItems.Select(item => item.Joint),
            _viewModel.SelectedRigJoint?.Joint.Id,
            _viewModel.CanEditRig);
    }

    private void OnCanvasSceneClicked(Point2D scenePoint) => _viewModel?.SelectModelPartAt(scenePoint);
    private void OnCanvasTransformStarted(TransformGestureStart gesture) => _viewModel?.BeginModelPartTransform(gesture);
    private void OnCanvasTransformMoved(Point2D scenePoint) => _viewModel?.UpdateModelPartTransform(scenePoint);
    private void OnCanvasTransformCompleted() => _viewModel?.CompleteModelPartTransform();
    private void OnRigAnchorDragStarted(RigJointId jointId, bool isParentAnchor) => _viewModel?.BeginRigAnchorDrag(jointId, isParentAnchor);
    private SnapResult OnRigAnchorDragMoved(Point2D pointer, double snapThreshold) =>
        _viewModel?.UpdateRigAnchorDrag(pointer, snapThreshold) ?? new SnapResult(Point2D.Zero, null, null);
    private void OnRigAnchorDragCompleted() => _viewModel?.CompleteRigAnchorDrag();
}
