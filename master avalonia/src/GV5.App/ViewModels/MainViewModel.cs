using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GV5.App.Navigation;
using GV5.Application.Contracts;

namespace GV5.App.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    [ObservableProperty]
    private ModuleRoute activeRoute = null!;

    [ObservableProperty]
    private IModulePageViewModel currentPage = null!;

    [ObservableProperty]
    private string? navigationError;

    private readonly ModuleRouteCatalog _routeCatalog;
    private readonly IModulePageFactory _pageFactory;

    public IReadOnlyList<ModuleRoute> Routes => _routeCatalog.Routes;

    public MainViewModel(ModuleRouteCatalog routeCatalog, IModulePageFactory pageFactory)
    {
        _routeCatalog = routeCatalog;
        _pageFactory = pageFactory;
        Navigate(_routeCatalog.DefaultRoute.Id);
    }

    [RelayCommand]
    private void Navigate(string? routeId)
    {
        if (!_routeCatalog.TryGet(routeId, out var route) || route is null)
        {
            NavigationError = $"A área '{routeId}' não está registrada.";
            return;
        }

        var page = _pageFactory.Create(route);
        ActiveRoute = route;
        CurrentPage = page;
        NavigationError = null;
    }
}
