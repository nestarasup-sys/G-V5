using Avalonia;
using Avalonia.Controls;
using Avalonia.Media.Imaging;

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

    public FabricatorCanvas() => InitializeComponent();

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
        }
    }
}
