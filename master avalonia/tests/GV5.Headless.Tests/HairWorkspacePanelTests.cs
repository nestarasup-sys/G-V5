using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Views;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class HairWorkspacePanelTests
{
    [AvaloniaFact]
    public void HairPanelLoadsImportControlsPaletteAndTwoPreviewSlots()
    {
        var viewModel = new HairWorkspaceViewModel(null, null, null);
        var panel = new HairWorkspacePanel { DataContext = viewModel };
        var window = new Window { Width = 520, Height = 720, Content = panel };
        window.Show();

        try
        {
            Assert.NotNull(panel.GetVisualDescendants().OfType<Button>()
                .SingleOrDefault(button => button.Content?.ToString()?.Contains("Importar folha", StringComparison.Ordinal) == true));
            Assert.Equal(5, viewModel.RoleColors.Count);
            Assert.Equal(3, viewModel.Modes.Count);
            Assert.NotNull(panel.GetVisualDescendants().OfType<Image>().SingleOrDefault(image => image.Name == "PosteriorImage"));
            Assert.NotNull(panel.GetVisualDescendants().OfType<Image>().SingleOrDefault(image => image.Name == "TraseiroImage"));
            Assert.False(viewModel.SelectSheetCommand.CanExecute(null));
        }
        finally
        {
            window.Close();
            viewModel.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }
}
