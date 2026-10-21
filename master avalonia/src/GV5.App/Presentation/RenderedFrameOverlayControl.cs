using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace GV5.App.Presentation;

/// <summary>Draws temporary editor adorners over an image without modifying its rendered frame.</summary>
public sealed class RenderedFrameOverlayControl : Control
{
    public static readonly StyledProperty<Size> FrameSizeProperty =
        AvaloniaProperty.Register<RenderedFrameOverlayControl, Size>(nameof(FrameSize));

    public static readonly StyledProperty<EditorOverlayState?> OverlayProperty =
        AvaloniaProperty.Register<RenderedFrameOverlayControl, EditorOverlayState?>(nameof(Overlay));

    private const int MaxGridLinesPerAxis = 1024;

    public Size FrameSize
    {
        get => GetValue(FrameSizeProperty);
        set => SetValue(FrameSizeProperty, value);
    }

    public EditorOverlayState? Overlay
    {
        get => GetValue(OverlayProperty);
        set => SetValue(OverlayProperty, value);
    }

    public RenderedFrameOverlayControl()
    {
        IsHitTestVisible = false;
        Focusable = false;
        ClipToBounds = true;
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == FrameSizeProperty || change.Property == OverlayProperty)
        {
            InvalidateVisual();
        }
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var overlay = Overlay;
        var frameSize = FrameSize;
        if (overlay is null || !IsPositiveFinite(frameSize.Width) || !IsPositiveFinite(frameSize.Height) ||
            !IsPositiveFinite(Bounds.Width) || !IsPositiveFinite(Bounds.Height))
        {
            return;
        }

        // Match an image presented with uniform fit; keep overlays aligned and clipped to the image.
        var scale = Math.Min(Bounds.Width / frameSize.Width, Bounds.Height / frameSize.Height);
        var imageWidth = frameSize.Width * scale;
        var imageHeight = frameSize.Height * scale;
        var imageBounds = new Rect((Bounds.Width - imageWidth) / 2, (Bounds.Height - imageHeight) / 2, imageWidth, imageHeight);
        using (context.PushClip(imageBounds))
        {
            if (overlay.ShowGrid)
            {
                DrawGrid(context, overlay, frameSize, imageBounds);
            }

            if (overlay.SelectionBounds is { } selection)
            {
                var mapped = Map(selection, frameSize, imageBounds);
                context.DrawRectangle(null, new Pen(new SolidColorBrush(overlay.Style.SelectionColor), overlay.Style.StrokeThickness), mapped);
            }

            var pivotBrush = new SolidColorBrush(overlay.Style.PivotColor);
            foreach (var pivot in overlay.Pivots)
            {
                var center = Map(pivot, frameSize, imageBounds);
                context.DrawEllipse(pivotBrush, null, center, overlay.Style.PivotRadius, overlay.Style.PivotRadius);
            }
        }
    }

    private static void DrawGrid(DrawingContext context, EditorOverlayState overlay, Size frameSize, Rect imageBounds)
    {
        var gridPen = new Pen(new SolidColorBrush(overlay.Style.GridColor), overlay.Style.StrokeThickness);
        var verticalSpacing = Math.Max(overlay.GridSpacing, frameSize.Width / MaxGridLinesPerAxis);
        var horizontalSpacing = Math.Max(overlay.GridSpacing, frameSize.Height / MaxGridLinesPerAxis);
        var verticalCount = (int)Math.Min(Math.Floor(frameSize.Width / verticalSpacing), MaxGridLinesPerAxis);
        var horizontalCount = (int)Math.Min(Math.Floor(frameSize.Height / horizontalSpacing), MaxGridLinesPerAxis);

        for (var index = 1; index <= verticalCount; index++)
        {
            var x = imageBounds.X + index * verticalSpacing * imageBounds.Width / frameSize.Width;
            context.DrawLine(gridPen, new Point(x, imageBounds.Top), new Point(x, imageBounds.Bottom));
        }
        for (var index = 1; index <= horizontalCount; index++)
        {
            var y = imageBounds.Y + index * horizontalSpacing * imageBounds.Height / frameSize.Height;
            context.DrawLine(gridPen, new Point(imageBounds.Left, y), new Point(imageBounds.Right, y));
        }
    }

    private static Point Map(Point point, Size frameSize, Rect imageBounds) =>
        new(imageBounds.X + point.X * imageBounds.Width / frameSize.Width,
            imageBounds.Y + point.Y * imageBounds.Height / frameSize.Height);

    private static Rect Map(Rect rect, Size frameSize, Rect imageBounds) =>
        new(imageBounds.X + rect.X * imageBounds.Width / frameSize.Width,
            imageBounds.Y + rect.Y * imageBounds.Height / frameSize.Height,
            rect.Width * imageBounds.Width / frameSize.Width,
            rect.Height * imageBounds.Height / frameSize.Height);

    private static bool IsPositiveFinite(double value) => double.IsFinite(value) && value > 0;
}
