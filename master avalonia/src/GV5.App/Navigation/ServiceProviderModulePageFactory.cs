using GV5.Application.Contracts;
using Microsoft.Extensions.DependencyInjection;

namespace GV5.App.Navigation;

internal sealed class ServiceProviderModulePageFactory(IServiceProvider services) : IModulePageFactory
{
    public IModulePageViewModel Create(ModuleRoute route)
    {
        ArgumentNullException.ThrowIfNull(route);

        return services.GetRequiredService(route.ViewModelType) as IModulePageViewModel
            ?? throw new InvalidOperationException($"The registered page '{route.Id}' does not implement {nameof(IModulePageViewModel)}.");
    }
}
