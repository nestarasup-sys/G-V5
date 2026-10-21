using GV5.Application.Contracts;

namespace GV5.App.Navigation;

/// <summary>A validated, immutable list of statically registered module routes.</summary>
public sealed class ModuleRouteCatalog
{
    private readonly IReadOnlyDictionary<string, ModuleRoute> _routesById;

    public IReadOnlyList<ModuleRoute> Routes { get; }

    public ModuleRoute DefaultRoute => Routes[0];

    public ModuleRouteCatalog(IEnumerable<ModuleRoute> routes)
    {
        ArgumentNullException.ThrowIfNull(routes);

        var routeList = routes.ToArray();
        if (routeList.Length == 0)
        {
            throw new ArgumentException("At least one module route must be registered.", nameof(routes));
        }

        var routeMap = new Dictionary<string, ModuleRoute>(StringComparer.Ordinal);
        foreach (var route in routeList)
        {
            ArgumentNullException.ThrowIfNull(route);
            if (!routeMap.TryAdd(route.Id, route))
            {
                throw new ArgumentException($"The module route ID '{route.Id}' is registered more than once.", nameof(routes));
            }
        }

        Routes = Array.AsReadOnly(routeList);
        _routesById = routeMap;
    }

    public bool TryGet(string? routeId, out ModuleRoute? route)
    {
        if (routeId is not null && _routesById.TryGetValue(routeId, out var found))
        {
            route = found;
            return true;
        }

        route = null;
        return false;
    }
}

/// <summary>Creates a module page ViewModel after the shell resolves a route.</summary>
public interface IModulePageFactory
{
    IModulePageViewModel Create(ModuleRoute route);
}
