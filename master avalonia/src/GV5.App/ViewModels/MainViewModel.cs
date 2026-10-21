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
    [NotifyPropertyChangedFor(nameof(HasNavigationError))]
    private string? navigationError;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(NavigateCommand))]
    private bool isNavigating;

    private readonly ModuleRouteCatalog _routeCatalog;
    private readonly IModulePageFactory _pageFactory;

    public IReadOnlyList<ModuleRoute> Routes => _routeCatalog.Routes;
    public bool HasNavigationError => !string.IsNullOrWhiteSpace(NavigationError);

    public MainViewModel(ModuleRouteCatalog routeCatalog, IModulePageFactory pageFactory)
    {
        _routeCatalog = routeCatalog;
        _pageFactory = pageFactory;
        SetRoute(_routeCatalog.DefaultRoute);
    }

    [RelayCommand(CanExecute = nameof(CanNavigate))]
    private async Task NavigateAsync(string? routeId)
    {
        if (!_routeCatalog.TryGet(routeId, out var route) || route is null)
        {
            NavigationError = $"A área '{routeId}' não está registrada.";
            return;
        }

        if (route.Id == ActiveRoute.Id)
        {
            NavigationError = null;
            return;
        }

        IsNavigating = true;
        try
        {
            if (!await FlushCurrentPageAsync())
            {
                NavigationError = "Não foi possível salvar as alterações pendentes. A área atual foi mantida; corrija o erro e tente novamente.";
                return;
            }

            SetRoute(route);
            NavigationError = null;
        }
        catch (Exception)
        {
            NavigationError = "Não foi possível salvar as alterações pendentes. A área atual foi mantida; tente novamente.";
        }
        finally
        {
            IsNavigating = false;
        }
    }

    public async Task<bool> FlushCurrentPageAsync(CancellationToken cancellationToken = default)
    {
        if (CurrentPage is not IFlushablePageViewModel flushable)
        {
            return true;
        }

        return await flushable.FlushPendingChangesAsync(cancellationToken);
    }

    private bool CanNavigate(string? _) => !IsNavigating;

    private void SetRoute(ModuleRoute route)
    {
        var page = _pageFactory.Create(route);
        if (CurrentPage is IDisposable disposablePage)
        {
            disposablePage.Dispose();
        }
        ActiveRoute = route;
        CurrentPage = page;
    }
}
