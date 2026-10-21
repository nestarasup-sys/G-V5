using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace GV5.Modules.Fabricador.Views;

/// <summary>Draws a lightweight model-space guide without adding one visual control per grid line.</summary>
public sealed class FabricatorGridOverlay : Control
{
    private static readonly Pen GridPen = new(new SolidColorBrush(Color.FromArgb(42, 111, 79, 103)), 1);
    private double _scale;
    private int _sceneWidth;
    private int _sceneHeight;

    public void SetGrid(double scale, int sceneWidth, int sceneHeight)
    {
        if (!double.IsFinite(scale) || scale <= 0 || sceneWidth <= 0 || sceneHeight <= 0)
        {
            ClearGrid();
            return;
        }

        _scale = scale;
        _sceneWidth = sceneWidth;
        _sceneHeight = sceneHeight;
        InvalidateVisual();
    }

    public void ClearGrid()
    {
        if (_scale == 0) return;
        _scale = 0;
        _sceneWidth = 0;
        _sceneHeight = 0;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_scale <= 0 || _sceneWidth <= 0 || _sceneHeight <= 0) return;

        var bounds = new Rect(0, 0, Bounds.Width, Bounds.Height);
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        using (context.PushClip(bounds))
        {
            var sceneStep = GetSceneStep(_scale);
            for (var x = 0d; x < _sceneWidth; x += sceneStep)
            {
                var screenX = x * _scale;
                context.DrawLine(GridPen, new Point(screenX, bounds.Y), new Point(screenX, bounds.Bottom));
            }

            for (var y = 0d; y < _sceneHeight; y += sceneStep)
            {
                var screenY = y * _scale;
                context.DrawLine(GridPen, new Point(bounds.X, screenY), new Point(bounds.Right, screenY));
            }
        }
    }

    private static int GetSceneStep(double scale)
    {
        var step = 32;
        while (step * scale < 12 && step < 4096) step *= 2;
        while (step * scale > 64 && step > 1) step /= 2;
        return step;
    }
}
