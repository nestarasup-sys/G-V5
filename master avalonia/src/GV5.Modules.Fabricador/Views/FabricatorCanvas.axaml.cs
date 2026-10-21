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
    public Point2D? RotationPivot { get; private set; }
    public FabricatorTool CurrentTool { get; private set; } = FabricatorTool.Select;
    public Action<Point2D>? SceneClicked { get; set; }
    public Action<TransformGestureStart>? TransformGestureStarted { get; set; }
    public Action<Point2D>? TransformGestureMoved { get; set; }
    public Action? TransformGestureCompleted { get; set; }
    private bool _isPanning;
    private ModelPartTransformKind? _activeTransformKind;
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

    public void SetSelection(Rect2D? bounds, Point2D? rotationPivot = null)
    {
        SelectedBounds = bounds;
        RotationPivot = bounds is null ? null : rotationPivot;
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
            var scenePoint = ScreenToScene(point);
            if (TryGetHandleGesture(point, out var handleGesture))
            {
                BeginTransform(handleGesture, scenePoint, e);
                return;
            }

            SceneClicked?.Invoke(scenePoint);
            if (SelectedBounds is { } bounds && bounds.Contains(scenePoint))
            {
                BeginTransform(ModelPartTransformKind.Move, scenePoint, e);
                return;
            }

            e.Handled = true;
        }
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (_activeTransformKind is not null)
        {
            TransformGestureMoved?.Invoke(ScreenToScene(e.GetPosition(Viewport)));
            e.Handled = true;
            return;
        }

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
        if (_activeTransformKind is not null)
        {
            _activeTransformKind = null;
            e.Pointer.Capture(null);
            TransformGestureCompleted?.Invoke();
            e.Handled = true;
            return;
        }

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

    private bool TryGetHandleGesture(Point pointer, out ModelPartTransformKind kind)
    {
        if (Frame is null || SelectedBounds is not { } bounds)
        {
            kind = default;
            return false;
        }

        var scale = GetBaseScale() * ZoomFactor;
        var left = (Viewport.Bounds.Width - Frame.PixelSize.Width * scale) / 2 + PanOffset.X;
        var top = (Viewport.Bounds.Height - Frame.PixelSize.Height * scale) / 2 + PanOffset.Y;
        var scaleHandle = new Point(left + bounds.Right * scale, top + bounds.Bottom * scale);
        if (Math.Abs(pointer.X - scaleHandle.X) <= 10 && Math.Abs(pointer.Y - scaleHandle.Y) <= 10)
        {
            kind = ModelPartTransformKind.Scale;
            return true;
        }

        var pivot = RotationPivot ?? new Point2D(bounds.X + bounds.Width / 2, bounds.Y + bounds.Height / 2);
        var pivotScreen = new Point(left + pivot.X * scale, top + pivot.Y * scale);
        var rotateHandle = new Point(pivotScreen.X, pivotScreen.Y - 24);
        var rotateDx = pointer.X - rotateHandle.X;
        var rotateDy = pointer.Y - rotateHandle.Y;
        if (rotateDx * rotateDx + rotateDy * rotateDy <= 100)
        {
            kind = ModelPartTransformKind.Rotate;
            return true;
        }

        kind = default;
        return false;
    }

    private void BeginTransform(ModelPartTransformKind kind, Point2D scenePoint, PointerPressedEventArgs e)
    {
        _activeTransformKind = kind;
        e.Pointer.Capture(Viewport);
        TransformGestureStarted?.Invoke(new TransformGestureStart(kind, scenePoint));
        e.Handled = true;
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
            SelectionOverlay.IsVisible = false;
            RotationStem.IsVisible = false;
            RotationHandle.IsVisible = false;
            ScaleHandle.IsVisible = false;
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
            var scaleHandleLeft = left + bounds.Right * scale - ScaleHandle.Width / 2;
            var scaleHandleTop = top + bounds.Bottom * scale - ScaleHandle.Height / 2;
            Canvas.SetLeft(ScaleHandle, scaleHandleLeft);
            Canvas.SetTop(ScaleHandle, scaleHandleTop);
            ScaleHandle.IsVisible = true;

            var pivot = RotationPivot ?? new Point2D(bounds.X + bounds.Width / 2, bounds.Y + bounds.Height / 2);
            var pivotScreen = new Point(left + pivot.X * scale, top + pivot.Y * scale);
            Canvas.SetLeft(RotationHandle, pivotScreen.X - RotationHandle.Width / 2);
            Canvas.SetTop(RotationHandle, pivotScreen.Y - 24 - RotationHandle.Height / 2);
            RotationStem.StartPoint = pivotScreen;
            RotationStem.EndPoint = new Point(pivotScreen.X, pivotScreen.Y - 24);
            RotationStem.IsVisible = true;
            RotationHandle.IsVisible = true;
        }
        else
        {
            SelectionOverlay.IsVisible = false;
            ScaleHandle.IsVisible = false;
            RotationHandle.IsVisible = false;
            RotationStem.IsVisible = false;
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
