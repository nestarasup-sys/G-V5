using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace GV5.App.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    [ObservableProperty]
    private string activeArea = "Fabricador";

    [ObservableProperty]
    private string areaDescription = "Fundação de modelos, peças, geometria e assets do G-V5.";

    [RelayCommand]
    private void ShowFabricator()
    {
        ActiveArea = "Fabricador";
        AreaDescription = "Fundação de modelos, peças, geometria e assets do G-V5.";
    }

    [RelayCommand]
    private void ShowCustomizer()
    {
        ActiveArea = "Customizador";
        AreaDescription = "Personagens e overrides serão construídos sobre os dados publicados pelo Fabricador.";
    }
}
