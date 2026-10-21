using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media.Imaging;
using Avalonia.Controls.Shapes;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;

namespace GV5.Modules.Fabricador.Views;

/// <summary>Fabricator's presentation surface. Rendering and scene composition happen outside this control.</summary>
public partial class FabricatorCanvas : UserControl
{
    public static readonly StyledProperty<Bitmap?> FrameProperty =
        AvaloniaProperty.Register<FabricatorCanvas, Bitmap?>(nameof(Frame));

    public Bitmap? Frame
    {
        get => GetValue(FrameProperty);
        set => SetValue(FrameProperty, value);
    }

    public double ZoomFactor { get; private set; } = 1;
    public Vector PanOffset { get; private set; }
    public Rect2D? SelectedBounds { get; private set; }
    public FabricatorTool CurrentTool { get; private set; } = FabricatorTool.Select;
    public Action<Point2D>? SceneClicked { get; set; }
    private bool _isPanning;
    private Point _pointerStart;
    private Vector _panStart;

    public FabricatorCanvas()
    {
        InitializeComponent();
        Viewport.SizeChanged += (_, _) => UpdateViewport();
        UpdateViewport();
    }

    public void SetTool(FabricatorTool tool)
    {
        if (!Enum.IsDefined(tool))
        {
            throw new ArgumentOutOfRangeException(nameof(tool));
        }

        CurrentTool = tool;
        Cursor = new Cursor(tool == FabricatorTool.Pan ? StandardCursorType.Hand : StandardCursorType.Arrow);
    }

    public void SetSelection(Rect2D? bounds)
    {
        SelectedBounds = bounds;
        UpdateViewport();
    }

    private void OnPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (Frame is null)
        {
            return;
        }

        var point = e.GetPosition(Viewport);
        var properties = e.GetCurrentPoint(Viewport).Properties;
        if (properties.IsMiddleButtonPressed || (CurrentTool == FabricatorTool.Pan && properties.IsLeftButtonPressed))
        {
            _isPanning = true;
            _pointerStart = point;
            _panStart = PanOffset;
            e.Pointer.Capture(Viewport);
            e.Handled = true;
            return;
        }

        if (properties.IsLeftButtonPressed && CurrentTool == FabricatorTool.Select)
        {
            SceneClicked?.Invoke(ScreenToScene(point));
            e.Handled = true;
        }
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (!_isPanning)
        {
            return;
        }

        var point = e.GetPosition(Viewport);
        PanOffset = _panStart + (point - _pointerStart);
        UpdateViewport();
        e.Handled = true;
    }

    private void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (!_isPanning)
        {
            return;
        }

        _isPanning = false;
        e.Pointer.Capture(null);
        e.Handled = true;
    }

    private void OnPointerWheelChanged(object? sender, PointerWheelEventArgs e)
    {
        if (Frame is null)
        {
            return;
        }

        ZoomAt(e.GetPosition(Viewport), e.Delta.Y > 0 ? 1.1 : 1 / 1.1);
        e.Handled = true;
    }

    public void ZoomAt(Point point, double factor)
    {
        if (!double.IsFinite(factor) || factor <= 0 || Frame is null)
        {
            return;
        }

        var scenePoint = ScreenToScene(point);
        var nextZoom = Math.Clamp(ZoomFactor * factor, 0.1, 8);
        if (Math.Abs(nextZoom - ZoomFactor) < 0.0001)
        {
            return;
        }

        var nextScale = GetBaseScale() * nextZoom;
        ZoomFactor = nextZoom;
        PanOffset = new Vector(
            point.X - scenePoint.X * nextScale - (Viewport.Bounds.Width - Frame.PixelSize.Width * nextScale) / 2,
            point.Y - scenePoint.Y * nextScale - (Viewport.Bounds.Height - Frame.PixelSize.Height * nextScale) / 2);
        UpdateViewport();
    }

    public void PanBy(Vector delta)
    {
        PanOffset += delta;
        UpdateViewport();
    }

    public Point2D ScreenToScene(Point point)
    {
        var frame = Frame ?? throw new InvalidOperationException("The model canvas has no rendered frame.");
        var scale = GetBaseScale() * ZoomFactor;
        var left = (Viewport.Bounds.Width - frame.PixelSize.Width * scale) / 2 + PanOffset.X;
        var top = (Viewport.Bounds.Height - frame.PixelSize.Height * scale) / 2 + PanOffset.Y;
        return new Point2D((point.X - left) / scale, (point.Y - top) / scale);
    }

    private double GetBaseScale() => Frame is null || Viewport.Bounds.Width <= 0 || Viewport.Bounds.Height <= 0
        ? 1
        : Math.Min(Viewport.Bounds.Width / Frame.PixelSize.Width, Viewport.Bounds.Height / Frame.PixelSize.Height);

    private void UpdateViewport()
    {
        if (Frame is null || Viewport.Bounds.Width <= 0 || Viewport.Bounds.Height <= 0)
        {
            EmptyMessage.IsVisible = Frame is null;
            ModelImage.Source = null;
            SelectionOverlay.Width = 0;
            SelectionOverlay.Height = 0;
            return;
        }

        var scale = GetBaseScale() * ZoomFactor;
        var width = Frame.PixelSize.Width * scale;
        var height = Frame.PixelSize.Height * scale;
        var left = (Viewport.Bounds.Width - width) / 2 + PanOffset.X;
        var top = (Viewport.Bounds.Height - height) / 2 + PanOffset.Y;
        ImageLayer.Width = Viewport.Bounds.Width;
        ImageLayer.Height = Viewport.Bounds.Height;
        ModelImage.Source = Frame;
        ModelImage.Width = width;
        ModelImage.Height = height;
        Canvas.SetLeft(ModelImage, left);
        Canvas.SetTop(ModelImage, top);

        if (SelectedBounds is { } bounds)
        {
            SelectionOverlay.Width = bounds.Width * scale;
            SelectionOverlay.Height = bounds.Height * scale;
            Canvas.SetLeft(SelectionOverlay, left + bounds.X * scale);
            Canvas.SetTop(SelectionOverlay, top + bounds.Y * scale);
            SelectionOverlay.IsVisible = true;
        }
        else
        {
            SelectionOverlay.IsVisible = false;
        }

        EmptyMessage.IsVisible = false;
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == FrameProperty)
        {
            if (change.OldValue is Bitmap oldFrame && !ReferenceEquals(oldFrame, Frame))
            {
                oldFrame.Dispose();
            }

            EmptyMessage.IsVisible = Frame is null;
            UpdateViewport();
        }
    }
}
