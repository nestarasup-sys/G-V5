using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
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
    public Action<RigJointId, bool>? RigAnchorDragStarted { get; set; }
    public Func<Point2D, double, SnapResult>? RigAnchorDragMoved { get; set; }
    public Action? RigAnchorDragCompleted { get; set; }
    private RigJoint[] _rigJoints = [];
    private RigJointId? _selectedRigJointId;
    private bool _canEditRig;
    private (RigJointId JointId, bool IsParent)? _activeRigAnchor;
    private SnapResult _activeRigSnap;
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

    public void SetRigJoints(IEnumerable<RigJoint> joints, RigJointId? selectedJointId, bool canEdit)
    {
        ArgumentNullException.ThrowIfNull(joints);
        _rigJoints = joints.ToArray();
        _selectedRigJointId = selectedJointId;
        _canEditRig = canEdit;
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
            if (TryGetRigAnchorHandle(point, out var anchorJoint, out var isParent))
            {
                _activeRigAnchor = (anchorJoint, isParent);
                e.Pointer.Capture(Viewport);
                RigAnchorDragStarted?.Invoke(anchorJoint, isParent);
                e.Handled = true;
                return;
            }

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
        if (_activeRigAnchor is not null)
        {
            var scale = GetBaseScale() * ZoomFactor;
            _activeRigSnap = RigAnchorDragMoved?.Invoke(ScreenToScene(e.GetPosition(Viewport)), scale <= 0 ? 0 : 8 / scale)
                ?? new SnapResult(Point2D.Zero, null, null);
            UpdateSnapGuides();
            e.Handled = true;
            return;
        }

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
        if (_activeRigAnchor is not null)
        {
            _activeRigAnchor = null;
            _activeRigSnap = new SnapResult(Point2D.Zero, null, null);
            UpdateSnapGuides();
            e.Pointer.Capture(null);
            RigAnchorDragCompleted?.Invoke();
            e.Handled = true;
            return;
        }

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

    private bool TryGetRigAnchorHandle(Point pointer, out RigJointId jointId, out bool isParent)
    {
        jointId = default;
        isParent = false;
        if (!_canEditRig || _selectedRigJointId is not { } selected || Frame is null) return false;
        var joint = _rigJoints.FirstOrDefault(candidate => candidate.Id == selected);
        if (joint.Id != selected) return false;
        var parent = AnchorToScreen(joint.ParentAnchor);
        var child = AnchorToScreen(joint.ChildAnchor);
        if (DistanceSquared(pointer, parent) <= 100)
        {
            jointId = selected;
            isParent = true;
            return true;
        }
        if (DistanceSquared(pointer, child) <= 100)
        {
            jointId = selected;
            isParent = false;
            return true;
        }
        return false;
    }

    private Point AnchorToScreen(Point2D anchor)
    {
        var frame = Frame ?? throw new InvalidOperationException("The model canvas has no rendered frame.");
        var scale = GetBaseScale() * ZoomFactor;
        var left = (Viewport.Bounds.Width - frame.PixelSize.Width * scale) / 2 + PanOffset.X;
        var top = (Viewport.Bounds.Height - frame.PixelSize.Height * scale) / 2 + PanOffset.Y;
        return new Point(left + anchor.X * scale, top + anchor.Y * scale);
    }

    private static double DistanceSquared(Point left, Point right)
    {
        var dx = left.X - right.X;
        var dy = left.Y - right.Y;
        return dx * dx + dy * dy;
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
            RigGuideLayer.Children.Clear();
            return;
        }

        var scale = GetBaseScale() * ZoomFactor;
        var width = Frame.PixelSize.Width * scale;
        var height = Frame.PixelSize.Height * scale;
        var left = (Viewport.Bounds.Width - width) / 2 + PanOffset.X;
        var top = (Viewport.Bounds.Height - height) / 2 + PanOffset.Y;
        ImageLayer.Width = Viewport.Bounds.Width;
        ImageLayer.Height = Viewport.Bounds.Height;
        RigGuideLayer.Width = Viewport.Bounds.Width;
        RigGuideLayer.Height = Viewport.Bounds.Height;
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

        UpdateRigGuides();
        EmptyMessage.IsVisible = false;
    }

    private void UpdateRigGuides()
    {
        RigGuideLayer.Children.Clear();
        if (Frame is null) return;
        UpdateSnapGuides();
        foreach (var joint in _rigJoints)
        {
            var selected = _selectedRigJointId == joint.Id;
            var start = AnchorToScreen(joint.ParentAnchor);
            var end = AnchorToScreen(joint.ChildAnchor);
            var guide = new Line
            {
                StartPoint = start,
                EndPoint = end,
                Stroke = new SolidColorBrush(Color.Parse(joint.Mode == RigJointMode.Fixed ? "#C74677" : "#8B7FB1")),
                StrokeThickness = selected ? 2 : 1.25
            };
            RigGuideLayer.Children.Add(guide);
            AddAnchorHandle(start, selected, joint.Mode);
            AddAnchorHandle(end, selected, joint.Mode);
        }
    }

    private void UpdateSnapGuides()
    {
        if (RigGuideLayer is null || Frame is null) return;
        foreach (var child in RigGuideLayer.Children.OfType<Line>().Where(line => line.Tag as string == "snap").ToArray())
        {
            RigGuideLayer.Children.Remove(child);
        }

        var brush = new SolidColorBrush(Color.Parse("#3D8BBA"));
        if (_activeRigSnap.XMatch is { } xMatch)
        {
            var guide = new Line
            {
                StartPoint = new Point(xMatch.GuideCoordinate, 0),
                EndPoint = new Point(xMatch.GuideCoordinate, Viewport.Bounds.Height),
                Stroke = brush,
                StrokeThickness = 1,
                Tag = "snap"
            };
            RigGuideLayer.Children.Insert(0, guide);
        }

        if (_activeRigSnap.YMatch is { } yMatch)
        {
            var guide = new Line
            {
                StartPoint = new Point(0, yMatch.GuideCoordinate),
                EndPoint = new Point(Viewport.Bounds.Width, yMatch.GuideCoordinate),
                Stroke = brush,
                StrokeThickness = 1,
                Tag = "snap"
            };
            RigGuideLayer.Children.Insert(0, guide);
        }
    }

    private void AddAnchorHandle(Point point, bool selected, RigJointMode mode)
    {
        var size = selected ? 12 : 8;
        var handle = new Ellipse
        {
            Width = size,
            Height = size,
            Fill = new SolidColorBrush(Color.Parse(mode == RigJointMode.Fixed ? "#C74677" : "#8B7FB1")),
            Stroke = Brushes.White,
            StrokeThickness = selected ? 2 : 1
        };
        Canvas.SetLeft(handle, point.X - size / 2d);
        Canvas.SetTop(handle, point.Y - size / 2d);
        RigGuideLayer.Children.Add(handle);
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
