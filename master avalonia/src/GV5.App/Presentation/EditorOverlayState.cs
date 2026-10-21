using Avalonia;
using Avalonia.Media;
using System.Collections.Immutable;

namespace GV5.App.Presentation;

/// <summary>Visual parameters supplied by the editor; the presentation layer does not choose product colors.</summary>
public sealed record EditorOverlayStyle
{
    public Color GridColor { get; }
    public Color SelectionColor { get; }
    public Color PivotColor { get; }
    public double StrokeThickness { get; }
    public double PivotRadius { get; }

    public EditorOverlayStyle(
        Color gridColor,
        Color selectionColor,
        Color pivotColor,
        double strokeThickness,
        double pivotRadius)
    {
        RequirePositiveFinite(strokeThickness, nameof(strokeThickness));
        RequirePositiveFinite(pivotRadius, nameof(pivotRadius));
        GridColor = gridColor;
        SelectionColor = selectionColor;
        PivotColor = pivotColor;
        StrokeThickness = strokeThickness;
        PivotRadius = pivotRadius;
    }

    private static void RequirePositiveFinite(double value, string parameterName)
    {
        if (!double.IsFinite(value) || value <= 0)
        {
            throw new ArgumentOutOfRangeException(parameterName, "Overlay dimensions must be positive and finite.");
        }
    }
}

/// <summary>
/// Transient editor adorners in frame-pixel coordinates. This is UI state only and is intentionally
/// not part of RenderScene, asset data, or any persistence contract.
/// </summary>
public sealed record EditorOverlayState
{
    public bool ShowGrid { get; }
    public double GridSpacing { get; }
    public Rect? SelectionBounds { get; }
    public ImmutableArray<Point> Pivots { get; }
    public EditorOverlayStyle Style { get; }

    public EditorOverlayState(
        bool showGrid,
        double gridSpacing,
        Rect? selectionBounds,
        IEnumerable<Point>? pivots,
        EditorOverlayStyle style)
    {
        ArgumentNullException.ThrowIfNull(style);
        if (showGrid && (!double.IsFinite(gridSpacing) || gridSpacing <= 0))
        {
            throw new ArgumentOutOfRangeException(nameof(gridSpacing), "Visible grids require positive, finite spacing.");
        }
        if (selectionBounds is { } selection &&
            (!double.IsFinite(selection.X) || !double.IsFinite(selection.Y) ||
             !double.IsFinite(selection.Width) || !double.IsFinite(selection.Height) ||
             !double.IsFinite(selection.X + selection.Width) || !double.IsFinite(selection.Y + selection.Height) ||
             selection.Width < 0 || selection.Height < 0))
        {
            throw new ArgumentOutOfRangeException(nameof(selectionBounds), "Selection bounds must be finite and non-negative.");
        }

        var immutablePivots = pivots?.ToImmutableArray() ?? ImmutableArray<Point>.Empty;
        if (immutablePivots.Any(point => !double.IsFinite(point.X) || !double.IsFinite(point.Y)))
        {
            throw new ArgumentException("Pivot coordinates must be finite.", nameof(pivots));
        }

        ShowGrid = showGrid;
        GridSpacing = gridSpacing;
        SelectionBounds = selectionBounds;
        Pivots = immutablePivots;
        Style = style;
    }
}
